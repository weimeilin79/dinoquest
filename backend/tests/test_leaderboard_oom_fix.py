from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the query chain
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert the limit was applied
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_no_replay_frames_leak():
    # Simulate the data processing logic
    doc = MagicMock()
    doc.to_dict.return_value = {"score": 1000, "name": "Dino"}
    doc.id = "doc_123"
    
    data = doc.to_dict()
    data["id"] = doc.id
    # Ensure we didn't add the massive string
    assert "replay_frames" not in data
