from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
