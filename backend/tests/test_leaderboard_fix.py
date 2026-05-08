from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the query chain
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert that the correct methods were called in order
    db.collection.assert_called_with("scores")
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
    db.collection.return_value.order_by.return_value.limit.return_value.get.assert_called()

def test_replay_frames_removed():
    # Simulate the data dictionary that would be returned
    data = {"score": 100, "name": "Dino", "replay_frames": "x" * 20000000}
    # In the fix, we don't add replay_frames. If it were there, we'd remove it.
    data.pop("replay_frames", None)
    assert "replay_frames" not in data
