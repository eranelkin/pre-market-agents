from backend.schemas.input_schema import StockInput


def split(stocks: list[StockInput], chunk_size: int) -> list[list[StockInput]]:
    """
    Partition stocks into chunks of at most chunk_size.
    The last chunk may be smaller than chunk_size.
    """
    if chunk_size < 1:
        raise ValueError(f"chunk_size must be >= 1, got {chunk_size}")
    return [stocks[i : i + chunk_size] for i in range(0, len(stocks), chunk_size)]
