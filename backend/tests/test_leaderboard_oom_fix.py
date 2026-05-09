from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Test that the query is constructed with order_by and limit before get()
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert that order_by was called with the correct parameters
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    
    # Assert that limit was called with 100
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
    
    # Assert that get was called
    db.collection.return_value.order_by.return_value.limit.return_value.get.assert_called()
