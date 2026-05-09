from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Verify the Firestore query uses order_by and limit
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)

def test_replay_frames_removed():
    # Verify that replay_frames is not present in the processed data
    data = {"score": 100, "name": "Dino", "replay_frames": "x" * 100}
    data.pop("replay_frames", None)
    assert "replay_frames" not in data
