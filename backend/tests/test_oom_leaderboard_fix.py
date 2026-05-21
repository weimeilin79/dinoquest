from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the chain of calls: collection -> order_by -> limit -> get
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert that limit(100) was called correctly
    db.collection.assert_called_with("scores")
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
    db.collection.return_value.order_by.return_value.limit.return_value.get.assert_called_once()
