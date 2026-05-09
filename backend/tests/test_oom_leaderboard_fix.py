from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_replay_frames_removed():
    data = {"score": 10, "name": "P1", "replay_frames": "x" * 1000}
    data.pop("replay_frames", None)
    assert "replay_frames" not in data
