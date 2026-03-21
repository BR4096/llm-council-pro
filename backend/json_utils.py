"""Shared JSON parsing utilities for LLM output handling."""

import re

# Regex: backslash followed by any char that is NOT a valid JSON escape char
# Valid escapes: " \ / b f n r t u
_INVALID_ESCAPE_PATTERN = re.compile(r'\\([^"\\/bfnrtu])')


def escape_invalid_json_escapes(text: str) -> str:
    """
    Escape invalid JSON escape sequences in LLM output.

    LLMs sometimes output text like \(E = mc^2\) inside JSON strings.
    The \( and \) are invalid JSON escapes and cause json.loads() to fail.

    This function converts \( to \\(, \) to \\), etc.
    Valid escapes like \n, \t, \", \\ are left untouched.

    Args:
        text: Raw text that will be JSON-parsed

    Returns:
        Text with invalid escapes fixed
    """
    return _INVALID_ESCAPE_PATTERN.sub(r'\\\\\1', text)
