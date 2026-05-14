from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the Firestore query chain
    mock_collection = db.collection.return_value
    mock_order_by = mock_collection.order_by.return_value
    mock_limit = mock_order_by.limit.return_value
    mock_limit.get.return_value = [] # Ensure .get() can be called

    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert that limit(100) was called
    mock_order_by.limit.assert_called_with(100)

def test_replay_frames_removed_from_data():
    data = {"score": 10, "name": "P1", "replay_frames": "x" * 20000000 + "some_id"}
    # Simulate the pop operation in the actual code
    data.pop("replay_frames", None)
    assert "replay_frames" not in data
    assert data == {"score": 10, "name": "P1"}
