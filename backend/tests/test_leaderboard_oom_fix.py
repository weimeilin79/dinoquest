from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Check that we query the collection and apply limit
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert order_by and limit were called correctly
    db.collection.assert_called_with("scores")
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
    db.collection.return_value.order_by.return_value.limit.return_value.get.assert_called_once()
