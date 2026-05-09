import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
from backend.main import app
from google.cloud.firestore import Query

# Import the app instance from main.py

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture(autouse=True)
def mock_firebase_admin():
    with patch('firebase_admin.initialize_app') as mock_init_app, \
         patch('firebase_admin.firestore.client') as mock_firestore_client, \
         patch('firebase_admin.auth.verify_id_token') as mock_verify_id_token:

        # Mock Firestore client
        mock_db = MagicMock()
        mock_firestore_client.return_value = mock_db
        
        # Mock the collection, order_by, limit, and get chain
        mock_collection = MagicMock()
        mock_db.collection.return_value = mock_collection
        mock_order_by = MagicMock()
        mock_collection.order_by.return_value = mock_order_by
        mock_limit = MagicMock()
        mock_order_by.limit.return_value = mock_limit

        # Prepare mock documents for Firestore query
        mock_docs = []
        for i in range(150): # Create more than 100 documents to test limit
            mock_doc = MagicMock()
            mock_doc.to_dict.return_value = {"score": 200 - i, "name": f"Player {i}"}
            mock_doc.id = f"doc{i}"
            mock_docs.append(mock_doc)

        mock_limit.get.return_value = mock_docs

        # Mock verify_id_token to allow a valid admin user
        mock_verify_id_token.return_value = {"email": "admin@example.com"}

        yield # This allows the tests to run with the mocked objects

def test_get_leaderboard_success(client, mock_firebase_admin):
    response = client.get("/api/leaderboard", headers={"Authorization": "Bearer some_token"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    leaderboard = data["leaderboard"]
    
    # Assert that the limit of 100 is respected
    assert len(leaderboard) == 100

    # Assert that replay_frames is NOT present in any of the returned items
    for item in leaderboard:
        assert "replay_frames" not in item
        assert "score" in item
        assert "name" in item
        assert "id" in item
    
    # Assert that the scores are sorted correctly (highest first)
    for i in range(len(leaderboard) - 1):
        assert leaderboard[i]["score"] >= leaderboard[i+1]["score"]

    # Verify that the Firestore query was called with the correct parameters
    mock_firebase_admin[1].return_value.collection.assert_called_with("scores")
    mock_firebase_admin[1].return_value.collection.return_value.order_by.assert_called_with(
        "score", direction=Query.DESCENDING
    )
    mock_firebase_admin[1].return_value.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_get_leaderboard_unauthorized(client):
    response = client.get("/api/leaderboard")
    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"

def test_get_leaderboard_invalid_token(client):
    with patch('firebase_admin.auth.verify_id_token', side_effect=Exception("Invalid token")):
        response = client.get("/api/leaderboard", headers={"Authorization": "Bearer invalid_token"})
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid token"

def test_get_leaderboard_disabled_for_non_admin(client):
    with patch('backend.main.LEADERBOARD_ENABLED', False), patch('firebase_admin.auth.verify_id_token', return_value={"email": "user@example.com"}):
        response = client.get("/api/leaderboard", headers={"Authorization": "Bearer some_token"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Leaderboard is currently disabled"

def test_get_leaderboard_enabled_for_admin_even_if_disabled(client):
    with patch('backend.main.LEADERBOARD_ENABLED', False), patch('firebase_admin.auth.verify_id_token', return_value={"email": "admin@example.com"}):
        response = client.get("/api/leaderboard", headers={"Authorization": "Bearer admin_token"})
        assert response.status_code == 200
        assert response.json()["status"] == "success"
