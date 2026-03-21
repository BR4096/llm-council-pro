"""Export module for generating downloadable documents from conversations."""

from enum import Enum
from typing import Tuple, Dict, Any

from .markdown import export_markdown
from .pdf import export_pdf
from .docx_export import export_docx


class ExportFormat(Enum):
    """Supported export formats."""
    MARKDOWN = "markdown"
    PDF = "pdf"
    DOCX = "docx"


def export_conversation(
    conversation: Dict[str, Any],
    format: ExportFormat
) -> Tuple[bytes, str, str]:
    """
    Export a conversation to the specified format.

    Args:
        conversation: The conversation dict to export
        format: The export format (MARKDOWN, PDF, or DOCX)

    Returns:
        Tuple of (file_bytes, filename, mime_type)
    """
    # Generate short ID (first 8 chars)
    short_id = conversation.get("id", "unknown")[:8]

    if format == ExportFormat.MARKDOWN:
        file_bytes = export_markdown(conversation)
        filename = f"conversation-{short_id}.md"
        mime_type = "text/markdown"
    elif format == ExportFormat.PDF:
        file_bytes = export_pdf(conversation)
        filename = f"conversation-{short_id}.pdf"
        mime_type = "application/pdf"
    elif format == ExportFormat.DOCX:
        file_bytes = export_docx(conversation)
        filename = f"conversation-{short_id}.docx"
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        raise ValueError(f"Unsupported export format: {format}")

    return file_bytes, filename, mime_type
