from abc import ABC, abstractmethod


class BaseTool(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def description(self) -> str: ...

    @property
    @abstractmethod
    def parameters_schema(self) -> dict: ...

    @property
    def tool_definition(self) -> dict:
        """OpenAI-compatible tool schema — passed to provider complete() as tools=[...]."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters_schema,
            },
        }

    @abstractmethod
    async def execute(self, **kwargs) -> str:
        """Run the tool and return a plain-text result to inject into the LLM context."""
        ...
