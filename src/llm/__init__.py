"""
LLM Abstraction Layer

Provider-agnostic interface for multiple LLM backends.
"""

from llm.core.interface import LLMProvider
from llm.core.types import LLMInput, LLMOutput, Message, ToolCall, ToolDefinition, ToolResult
from llm.providers import get_provider
from llm.tools import ToolExecutor, ToolRegistry
from llm.cli.selector import interactive_select

__version__ = "0.1.0"

__all__ = [
    "LLMProvider",
    "LLMInput",
    "LLMOutput",
    "Message",
    "get_provider",
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "ToolExecutor",
    "ToolRegistry",
    "interactive_select",
]


def gui() -> None:
    from llm.cli.selector import main
    main()

