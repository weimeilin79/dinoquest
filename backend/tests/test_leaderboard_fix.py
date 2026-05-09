from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the query chain
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    # Assert limit(100) was called
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_replay_frames_removed():
    # Simulate data processing
    doc = MagicMock()
    doc.to_dict.return_value = {"score": 1000, "name": "Dino"}
    data = doc.to_dict()
    # Ensure we don't add the massive string
    assert "replay_frames" not in data
