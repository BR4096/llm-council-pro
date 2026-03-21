"""GFM pipe table parser for PDF/DOCX export.

Splits markdown content into alternating text and table segments,
allowing export renderers to insert native table objects.
"""

import re
from typing import List, Dict, Any, Union

# A segment is either plain text or a parsed table.
# Text segment: {"type": "text", "content": str}
# Table segment: {"type": "table", "headers": List[str], "rows": List[List[str]]}
Segment = Dict[str, Any]


_TABLE_LINE = re.compile(r'^\s*\|.+\|\s*$')
_SEPARATOR_LINE = re.compile(r'^\s*\|[\s\-:|\s]+\|\s*$')


def _is_table_line(line: str) -> bool:
    return bool(_TABLE_LINE.match(line))


def _is_separator_line(line: str) -> bool:
    """True if this is a markdown table separator row (|---|---|)."""
    return bool(_SEPARATOR_LINE.match(line)) and '-' in line


def _parse_row(line: str) -> List[str]:
    """Extract cell values from a pipe-delimited row."""
    # Strip leading/trailing pipe and whitespace, then split on |
    stripped = line.strip().strip('|')
    return [cell.strip() for cell in stripped.split('|')]


def _extract_table_blocks(text: str) -> List[Dict[str, Any]]:
    """
    Find all GFM pipe table spans in text.

    Returns list of dicts: {"start": int, "end": int, "headers": [...], "rows": [[...]]}
    where start/end are line indices (inclusive).
    """
    lines = text.splitlines()
    results = []
    i = 0

    while i < len(lines):
        # A table starts with a pipe line, followed immediately by a separator line
        if _is_table_line(lines[i]) and (i + 1) < len(lines) and _is_separator_line(lines[i + 1]):
            start = i
            headers = _parse_row(lines[i])
            i += 2  # skip header and separator

            rows = []
            while i < len(lines) and _is_table_line(lines[i]) and not _is_separator_line(lines[i]):
                rows.append(_parse_row(lines[i]))
                i += 1

            results.append({
                "start": start,
                "end": i - 1,
                "headers": headers,
                "rows": rows,
            })
        else:
            i += 1

    return results


def parse_markdown_tables(text: str) -> List[Segment]:
    """
    Split markdown text into a list of text and table segments.

    Each segment is a dict with "type" key:
    - {"type": "text", "content": str}  -- plain text (may be empty)
    - {"type": "table", "headers": List[str], "rows": List[List[str]]}

    Example:
        "Some text\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\nMore text"
        -> [
            {"type": "text", "content": "Some text"},
            {"type": "table", "headers": ["A", "B"], "rows": [["1", "2"]]},
            {"type": "text", "content": "More text"},
           ]
    """
    if not text:
        return [{"type": "text", "content": ""}]

    lines = text.splitlines()
    table_blocks = _extract_table_blocks(text)

    if not table_blocks:
        return [{"type": "text", "content": text}]

    segments: List[Segment] = []
    line_cursor = 0

    for block in table_blocks:
        # Text before this table
        if line_cursor < block["start"]:
            pre_text = "\n".join(lines[line_cursor:block["start"]])
            if pre_text.strip():
                segments.append({"type": "text", "content": pre_text})
        elif line_cursor == block["start"] and segments and segments[-1]["type"] == "text":
            pass  # already handled

        segments.append({
            "type": "table",
            "headers": block["headers"],
            "rows": block["rows"],
        })
        line_cursor = block["end"] + 1

    # Text after the last table
    if line_cursor < len(lines):
        post_text = "\n".join(lines[line_cursor:])
        if post_text.strip():
            segments.append({"type": "text", "content": post_text})

    return segments
