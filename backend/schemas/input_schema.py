from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class TechnicalData(BaseModel):
    rsi_14: float = Field(..., ge=0, le=100)
    macd_signal: Literal["bullish_crossover", "bearish_crossover", "neutral"]
    ma_50: float = Field(..., gt=0)
    ma_200: float = Field(..., gt=0)
    volume_vs_avg: float = Field(..., gt=0, description="Ratio to average daily volume; 1.0 = average")
    atr_14: float = Field(..., gt=0)
    support_level: float = Field(..., gt=0)
    resistance_level: float = Field(..., gt=0)

    @model_validator(mode="after")
    def resistance_above_support(self) -> "TechnicalData":
        if self.resistance_level <= self.support_level:
            raise ValueError("resistance_level must be greater than support_level")
        return self


class FundamentalData(BaseModel):
    pe_ratio: Optional[float] = Field(None, description="None acceptable for loss-making companies")
    eps_growth_yoy: float = Field(..., description="Year-over-year EPS growth as decimal; 0.12 = 12%")
    revenue_growth_yoy: float
    gross_margin: float = Field(..., ge=0, le=1)
    debt_to_equity: float = Field(..., ge=0)
    free_cash_flow_b: float = Field(..., description="Free cash flow in billions USD; negative allowed")


class SentimentData(BaseModel):
    analyst_rating: Literal["strong_buy", "buy", "hold", "sell", "strong_sell"]
    analyst_count: int = Field(..., ge=0)
    news_sentiment_score: float = Field(..., ge=-1.0, le=1.0)
    social_sentiment: Literal["positive", "neutral", "negative"]


class RiskData(BaseModel):
    beta: float
    week_52_high: float = Field(..., gt=0)
    week_52_low: float = Field(..., gt=0)
    implied_volatility: float = Field(..., ge=0)
    short_interest_pct: float = Field(..., ge=0, le=100)

    @model_validator(mode="after")
    def high_above_low(self) -> "RiskData":
        if self.week_52_high <= self.week_52_low:
            raise ValueError("week_52_high must be greater than week_52_low")
        return self


class MacroData(BaseModel):
    sector_momentum: Literal["positive", "neutral", "negative"]
    index_correlation: float = Field(..., ge=-1.0, le=1.0)
    upcoming_catalyst: Optional[str] = None


class StockInput(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    company_name: str
    sector: str
    market_cap_b: float = Field(..., gt=0)
    technical: TechnicalData
    fundamental: FundamentalData
    sentiment: SentimentData
    risk: RiskData
    macro: MacroData

    @field_validator("ticker", mode="before")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.strip().upper()


class InputFile(BaseModel):
    stocks: list[StockInput] = Field(..., min_length=1)

    @model_validator(mode="after")
    def no_duplicate_tickers(self) -> "InputFile":
        tickers = [s.ticker for s in self.stocks]
        duplicates = {t for t in tickers if tickers.count(t) > 1}
        if duplicates:
            raise ValueError(f"Duplicate tickers in input: {sorted(duplicates)}")
        return self
