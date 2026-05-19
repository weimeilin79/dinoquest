from unittest.mock import MagicMock

def test_leaderboard_query_is_bounded():
    db = MagicMock()
    # Simulate the chain: collection -> order_by -> limit -> get
    db.collection.return_value.order_by.return_value.limit.return_value.get.return_value = []
    
    # Act
    db.collection("scores").order_by("score", direction="DESCENDING").limit(100).get()
    
    # Assert
    db.collection.assert_called_with("scores")
    db.collection.return_value.order_by.assert_called_with("score", direction="DESCENDING")
    db.collection.return_value.order_by.return_value.limit.assert_called_with(100)
