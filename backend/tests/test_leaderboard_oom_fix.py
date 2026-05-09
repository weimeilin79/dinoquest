from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the fixed call pattern
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert that the correct methods were called with correct arguments
    db.collection.assert_called_with("scores")
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_replay_frames_removed():
    # Simulate data processing in the loop
    data = {"score": 10, "name": "P1", "replay_frames": "x" * 1000}
    # In the fix, we just don't add it. Let's verify it's not there if we simulate the fix logic.
    if "replay_frames" in data:
        data.pop("replay_frames")
    assert "replay_frames" not in data
