"""PDF export generator for conversations using ReportLab (pure Python, no system dependencies)."""

from typing import Dict, Any, List, Optional
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

from .content_processing import (
    get_display_name,
    process_export_content,
    build_extended_character_names
)
from .table_parser import parse_markdown_tables


# Color scheme matching the app's "Midnight Glass" theme (adapted for PDF light bg)
COLORS = {
    'primary': colors.HexColor('#1a365d'),      # Dark blue for H1
    'accent': colors.HexColor('#2563eb'),       # Blue for H2
    'secondary': colors.HexColor('#4b5563'),    # Gray for H3
    'text': colors.HexColor('#333333'),         # Dark text
    'error': colors.HexColor('#dc2626'),        # Red for errors
    'table_header': colors.HexColor('#f3f4f6'), # Light gray for table header
    'table_border': colors.HexColor('#d1d5db'), # Gray for table borders
    'light_bg': colors.HexColor('#f9fafb'),     # Very light gray for backgrounds
}


def _create_styles() -> Dict[str, ParagraphStyle]:
    """Create custom paragraph styles for the PDF."""
    styles = getSampleStyleSheet()

    # Title style (H1) - User query
    styles.add(ParagraphStyle(
        name='Title1',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=COLORS['primary'],
        spaceAfter=12,
        spaceBefore=6,
        borderColor=COLORS['primary'],
        borderWidth=0,
        borderPadding=0,
    ))

    # Stage header (H2)
    styles.add(ParagraphStyle(
        name='StageHeader',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=COLORS['accent'],
        spaceBefore=16,
        spaceAfter=8,
    ))

    # Model name (H3)
    styles.add(ParagraphStyle(
        name='ModelName',
        parent=styles['Heading3'],
        fontSize=12,
        textColor=COLORS['secondary'],
        spaceBefore=10,
        spaceAfter=4,
    ))

    # Body text
    styles.add(ParagraphStyle(
        name='CustomBody',
        parent=styles['Normal'],
        fontSize=11,
        textColor=COLORS['text'],
        spaceBefore=4,
        spaceAfter=8,
        leading=16,
    ))

    # Error text
    styles.add(ParagraphStyle(
        name='ErrorText',
        parent=styles['Normal'],
        fontSize=11,
        textColor=COLORS['error'],
        fontName='Helvetica-Oblique',
        spaceBefore=4,
        spaceAfter=8,
    ))

    # Metadata label
    styles.add(ParagraphStyle(
        name='MetadataLabel',
        parent=styles['Normal'],
        fontSize=11,
        textColor=COLORS['text'],
        fontName='Helvetica-Bold',
        spaceBefore=2,
        spaceAfter=2,
    ))

    # Metadata value
    styles.add(ParagraphStyle(
        name='MetadataValue',
        parent=styles['Normal'],
        fontSize=11,
        textColor=COLORS['text'],
        spaceBefore=2,
        spaceAfter=4,
    ))

    # Table cell body text — must be Paragraph so ReportLab wraps within column width
    styles.add(ParagraphStyle(
        name='TableCell',
        parent=styles['Normal'],
        fontSize=9,
        textColor=COLORS['text'],
        leading=12,
        wordWrap='CJK',
    ))

    # Table cell header text
    styles.add(ParagraphStyle(
        name='TableCellHeader',
        parent=styles['Normal'],
        fontSize=9,
        textColor=COLORS['text'],
        fontName='Helvetica-Bold',
        leading=12,
        wordWrap='CJK',
    ))

    return styles


def _strip_problematic_chars(text: str) -> str:
    """Remove emoji and Unicode characters that Helvetica can't render."""
    if not text:
        return ""

    # Remove emoji and other problematic Unicode
    # Keep: ASCII, Latin-1 Supplement, Latin Extended-A, common punctuation
    # This regex keeps printable ASCII plus accented characters
    result = []
    for char in text:
        code = ord(char)
        # Keep ASCII (0-127) and Latin-1 Supplement (128-255) for accented chars
        if code < 256:
            result.append(char)
        else:
            # Replace with space to maintain word boundaries
            result.append(' ')

    return ''.join(result)


def _escape_xml(text: str) -> str:
    """Escape XML special characters for ReportLab Paragraph."""
    if not text:
        return ""
    return (text
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;'))


def _format_content(text: str) -> str:
    """Format text content for PDF, handling basic markdown-like formatting."""
    if not text:
        return ""

    # Strip emoji and problematic Unicode FIRST (before escaping)
    text = _strip_problematic_chars(text)

    # Escape XML
    text = _escape_xml(text)

    # Convert markdown bold to XML bold
    import re
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'__(.+?)__', r'<b>\1</b>', text)

    # Convert markdown italic to XML italic
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    text = re.sub(r'_(.+?)_', r'<i>\1</i>', text)

    # Convert markdown code to mono font
    text = re.sub(r'`(.+?)`', r'<font face="Courier">\1</font>', text)

    # Convert markdown headers (###, ##, #) to bold with line breaks
    # Match headers at the start of a line
    def header_replacer(match):
        level = len(match.group(1))  # Number of # symbols
        content = match.group(2).strip()
        return f"<b>{content}</b>"
    text = re.sub(r'^(#{1,6})\s+(.+)$', header_replacer, text, flags=re.MULTILINE)

    # Handle line breaks - convert to <br/>
    text = text.replace('\n', '<br/>')

    return text


def _safe_paragraph(text: str, style) -> Paragraph:
    """Create a Paragraph with XML tag support, falling back to plain text if parsing fails."""
    try:
        return Paragraph(text, style)
    except Exception:
        import re
        plain = re.sub(r'<[^>]+>', '', text)
        plain = plain.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
        return Paragraph(_escape_xml(plain), style)


def _add_content_to_pdf(story: List, text: str, styles: Dict[str, ParagraphStyle]) -> None:
    """Add content to PDF story, rendering GFM pipe tables as native Table objects."""
    segments = parse_markdown_tables(text)
    for seg in segments:
        if seg["type"] == "text":
            content = seg["content"]
            if content.strip():
                story.append(_safe_paragraph(_format_content(content), styles['CustomBody']))
        else:
            # Render as ReportLab Table
            headers = seg["headers"]
            rows = seg["rows"]
            if not headers:
                continue

            # Build table data: header row + data rows.
            # Cells MUST be Paragraph objects — raw strings do not wrap in ReportLab Tables.
            cell_header_style = styles['TableCellHeader']
            cell_body_style = styles['TableCell']
            table_data = [[
                _safe_paragraph(_escape_xml(_strip_problematic_chars(h)), cell_header_style)
                for h in headers
            ]]
            for row in rows:
                table_data.append([
                    _safe_paragraph(_escape_xml(_strip_problematic_chars(c)), cell_body_style)
                    for c in row
                ])

            # Calculate column widths: distribute available width equally
            # A4 with 2cm margins each side = ~17cm usable
            usable_width = 17 * cm
            num_cols = len(headers)
            col_width = usable_width / num_cols if num_cols else usable_width
            col_widths = [col_width] * num_cols

            tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), COLORS['table_header']),
                ('TEXTCOLOR', (0, 0), (-1, 0), COLORS['text']),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
                ('TOPPADDING', (0, 0), (-1, 0), 6),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 4),
                ('BACKGROUND', (0, 1), (-1, -1), colors.white),
                ('GRID', (0, 0), (-1, -1), 0.5, COLORS['table_border']),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, COLORS['light_bg']]),
            ]))
            story.append(Spacer(1, 4))
            story.append(tbl)
            story.append(Spacer(1, 4))


def _add_stage1_pdf(
    story: List,
    stage1: List[Dict[str, Any]],
    character_names: Dict[str, str],
    styles: Dict[str, ParagraphStyle]
) -> None:
    """Add Stage 1 responses to the PDF story."""
    story.append(Paragraph("Stage 1: Initial Responses", styles['StageHeader']))

    for idx, response in enumerate(stage1):
        model_id = response.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"
        display_name = get_display_name(model_id, character_names, instance_key)

        story.append(Paragraph(_escape_xml(display_name), styles['ModelName']))

        content = response.get("response", "")
        error = response.get("error")

        if error:
            story.append(Paragraph(f"<i>Error: {_escape_xml(error)}</i>", styles['ErrorText']))
        elif content:
            _add_content_to_pdf(story, content, styles)

        story.append(Spacer(1, 8))


def _add_stage2_pdf(
    story: List,
    stage2: List[Dict[str, Any]],
    character_names: Dict[str, str],
    aggregate_rankings: Optional[List[Dict[str, Any]]] = None,
    label_to_model: Optional[Dict[str, str]] = None,
    label_to_instance_key: Optional[Dict[str, str]] = None,
    styles: Dict[str, ParagraphStyle] = None
) -> None:
    """Add Stage 2 rankings to the PDF story."""
    story.append(Paragraph("Stage 2: Peer Rankings", styles['StageHeader']))

    for idx, ranking in enumerate(stage2):
        model_id = ranking.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"
        display_name = get_display_name(model_id, character_names, instance_key)

        story.append(Paragraph(f"{_escape_xml(display_name)}'s Ranking", styles['ModelName']))

        content = ranking.get("ranking", "")
        error = ranking.get("error")

        if error:
            story.append(Paragraph(f"<i>Error: {_escape_xml(error)}</i>", styles['ErrorText']))
        elif content:
            # De-anonymize the ranking content
            processed_content = process_export_content(
                content,
                label_to_model=label_to_model,
                label_to_instance_key=label_to_instance_key,
                character_names=character_names
            )
            _add_content_to_pdf(story, processed_content, styles)

        story.append(Spacer(1, 8))

    # Add aggregate rankings table if available
    if aggregate_rankings:
        story.append(Spacer(1, 8))
        story.append(Paragraph("<b>Aggregate Rankings:</b>", styles['CustomBody']))
        story.append(Spacer(1, 4))

        table_data = [['Rank', 'Model', 'Average Score']]
        for item in aggregate_rankings:
            model_id = item.get("model", "Unknown")
            instance_key = item.get("instance_key", "")
            display_name = get_display_name(model_id, character_names, instance_key)
            avg_rank = item.get("average_rank", 0)
            table_data.append([
                str(item.get("rank", len(table_data))),
                display_name,
                f"{avg_rank:.1f}"
            ])

        table = Table(table_data, colWidths=[2*cm, 8*cm, 3*cm])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['table_header']),
            ('TEXTCOLOR', (0, 0), (-1, 0), COLORS['text']),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('ALIGN', (2, 0), (2, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, COLORS['table_border']),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(table)


def _add_stage3_pdf(
    story: List,
    stage3: List[Dict[str, Any]],
    character_names: Dict[str, str],
    styles: Dict[str, ParagraphStyle]
) -> None:
    """Add Stage 3 revisions to the PDF story."""
    story.append(Paragraph("Stage 3: Revisions", styles['StageHeader']))

    for idx, response in enumerate(stage3):
        model_id = response.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"
        display_name = get_display_name(model_id, character_names, instance_key)

        story.append(Paragraph(_escape_xml(display_name), styles['ModelName']))

        content = response.get("response", "")
        error = response.get("error")

        if error:
            story.append(Paragraph(f"<i>Error: {_escape_xml(error)}</i>", styles['ErrorText']))
        elif content:
            _add_content_to_pdf(story, content, styles)

        story.append(Spacer(1, 8))


def _add_stage4_pdf(
    story: List,
    stage4: Dict[str, Any],
    character_names: Dict[str, str],
    styles: Dict[str, ParagraphStyle]
) -> None:
    """Add Stage 4 analysis (truth-check, rankings, highlights) to the PDF story."""
    story.append(Paragraph("Stage 4: Analysis", styles['StageHeader']))

    # --- Truth-Check ---
    story.append(Paragraph("Truth-Check Results", styles['ModelName']))
    truth_check = stage4.get("truth_check") or {}
    if truth_check.get("checked") and truth_check.get("claims"):
        summary = truth_check.get("summary", {})
        verified = summary.get("confirmed", 0)
        flagged = summary.get("disputed", 0)
        unverifiable = summary.get("unaddressed", 0)
        story.append(Paragraph(
            f"<b>Summary:</b> {verified} confirmed, {flagged} disputed, {unverifiable} unaddressed",
            styles['CustomBody']
        ))
        for claim in truth_check["claims"]:
            verdict = claim.get("verdict", "Unknown")
            # Format claim text with markdown conversion
            text = _format_content(claim.get("text", ""))

            # New fields from quick-052 and quick-054
            priority = claim.get("priority", "medium")
            searched = claim.get("searched", True)
            reason = claim.get("reason", "")

            # Build claim line with priority badge
            priority_badge = f"[{priority.upper()}]" if priority != "medium" else ""
            searched_note = " (not verified)" if not searched else ""

            claim_parts = []
            if priority_badge:
                claim_parts.append(priority_badge)
            claim_parts.append(f"[{verdict}]")
            claim_parts.append(text)
            if searched_note:
                claim_parts.append(searched_note)

            claim_line = " ".join(claim_parts)
            story.append(Paragraph(claim_line, styles['CustomBody']))

            # Add reason for all verdicts if provided
            if reason:
                story.append(Paragraph(
                    f"  - Reason: {_format_content(reason)}",
                    styles['CustomBody']
                ))
    else:
        story.append(Paragraph(
            "Truth-check was not run for this conversation.",
            styles['CustomBody']
        ))

    # --- Rankings ---
    story.append(Spacer(1, 8))
    story.append(Paragraph("Chairman Rankings", styles['ModelName']))
    rankings_data = stage4.get("rankings") or {}
    rankings_list = rankings_data.get("rankings", [])
    if rankings_data.get("checked") and rankings_list:
        table_data = [['Rank', 'Model', 'Score', 'Reasoning', 'Insight', 'Clarity']]
        for rank_num, entry in enumerate(rankings_list, 1):
            display_name = get_display_name(entry.get("model", "Unknown"), character_names)
            score = str(int(entry.get("normalized_score", 0)))
            dims = entry.get("dimensions", {})
            reasoning = dims.get("reasoning", {}).get("label", "")
            insight = dims.get("insight", {}).get("label", "")
            clarity = dims.get("clarity", {}).get("label", "")
            table_data.append([str(rank_num), display_name, score, reasoning, insight, clarity])

        table = Table(table_data, colWidths=[1.2*cm, 5*cm, 2*cm, 3*cm, 3*cm, 3*cm])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['table_header']),
            ('TEXTCOLOR', (0, 0), (-1, 0), COLORS['text']),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('ALIGN', (2, 0), (2, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 0.5, COLORS['table_border']),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(table)
    else:
        story.append(Paragraph(
            "Rankings were not produced for this conversation.",
            styles['CustomBody']
        ))

    # --- Highlights ---
    story.append(Spacer(1, 8))
    story.append(Paragraph("Council Highlights", styles['ModelName']))
    highlights = stage4.get("highlights") or {}
    agreements = highlights.get("agreements", [])
    disagreements = highlights.get("disagreements", [])
    unique_insights = highlights.get("unique_insights", [])

    if agreements or disagreements or unique_insights:
        if agreements:
            story.append(Paragraph("<b>Agreements</b>", styles['CustomBody']))
            for item in agreements:
                model_names = ", ".join(
                    get_display_name(m, character_names) for m in item.get("models", [])
                )
                finding = _format_content(item.get("finding", ""))
                story.append(Paragraph(
                    f"- {finding} (models: {_escape_xml(model_names)})",
                    styles['CustomBody']
                ))
        if disagreements:
            story.append(Paragraph("<b>Disagreements</b>", styles['CustomBody']))
            for item in disagreements:
                topic = _escape_xml(item.get("topic", ""))
                why = _escape_xml(item.get("why_they_differ", ""))
                positions = item.get("positions", [])
                story.append(Paragraph(f"<b>{topic}</b>", styles['CustomBody']))
                if why:
                    story.append(Paragraph(f"  <i>Why they differ:</i> {why}", styles['CustomBody']))
                for pos in positions:
                    name = _escape_xml(get_display_name(pos.get("model_id", "Unknown"), character_names))
                    pos_text = _format_content(pos.get("position_text", ""))
                    story.append(Paragraph(f"  <b>{name}:</b> {pos_text}", styles['CustomBody']))
        if unique_insights:
            story.append(Paragraph("<b>Unique Insights</b>", styles['CustomBody']))
            for item in unique_insights:
                model_name = get_display_name(item.get("model", "Unknown"), character_names)
                finding = _format_content(item.get("finding", ""))
                story.append(Paragraph(
                    f"- {finding} ({_escape_xml(model_name)})",
                    styles['CustomBody']
                ))
    else:
        story.append(Paragraph(
            "No highlights were extracted for this conversation.",
            styles['CustomBody']
        ))

    # --- Debates ---
    debates = stage4.get("debates") or []
    completed_debates = [d for d in debates if d.get("transcript")]
    if completed_debates:
        story.append(Spacer(1, 8))
        story.append(Paragraph("Debates", styles['ModelName']))
        for debate in completed_debates:
            title = _escape_xml(debate.get("title", "Debate"))
            story.append(Paragraph(f"<b>{title}</b>", styles['CustomBody']))

            participants = debate.get("participants", [])
            if participants:
                parts_str = ", ".join(
                    f"{_escape_xml(p.get('name', 'Unknown'))} ({_escape_xml(p.get('role', ''))})"
                    for p in participants
                )
                story.append(Paragraph(f"<b>Participants:</b> {parts_str}", styles['CustomBody']))

            transcript = debate.get("transcript", [])
            if transcript:
                story.append(Paragraph("<b>Transcript</b>", styles['CustomBody']))
                for turn in transcript:
                    name = _escape_xml(turn.get("name", turn.get("role", "Unknown")))
                    text = _format_content(turn.get("text", ""))
                    story.append(Paragraph(f"<b>{name}:</b> {text}", styles['CustomBody']))

            verdict = (debate.get("verdict") or {}).get("summary", "")
            if verdict:
                story.append(Paragraph(
                    f"<b>Verdict:</b> {_escape_xml(verdict)}",
                    styles['CustomBody']
                ))
            story.append(Spacer(1, 6))

    story.append(Spacer(1, 8))


def _add_stage5_pdf(
    story: List,
    stage5: Dict[str, Any],
    character_names: Dict[str, str],
    chairman_character_name: Optional[str],
    styles: Dict[str, ParagraphStyle]
) -> None:
    """Add Stage 5 synthesis to the PDF story."""
    story.append(Paragraph("Stage 5: Chairman Synthesis", styles['StageHeader']))

    model_id = stage5.get("model", "Unknown")
    display_name = chairman_character_name if chairman_character_name else get_display_name(model_id, character_names)

    story.append(Paragraph(_escape_xml(display_name), styles['ModelName']))

    content = stage5.get("response", "")
    error = stage5.get("error")

    if error:
        story.append(Paragraph(f"<i>Error: {_escape_xml(error)}</i>", styles['ErrorText']))
    elif content:
        _add_content_to_pdf(story, content, styles)

    story.append(Spacer(1, 8))


def _add_metadata_pdf(
    story: List,
    conversation: Dict[str, Any],
    council_config: Optional[Dict[str, Any]],
    styles: Dict[str, ParagraphStyle]
) -> None:
    """Add metadata section to the PDF story."""
    # Horizontal rule separator
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=COLORS['table_border']))
    story.append(Spacer(1, 16))

    story.append(Paragraph("Conversation Details", styles['StageHeader']))

    # Basic info
    created_at = conversation.get("created_at", "Unknown")
    story.append(Paragraph(f"<b>Timestamp:</b> {_escape_xml(created_at)}", styles['CustomBody']))

    # Find execution mode
    execution_mode = "Unknown"
    for msg in conversation.get("messages", []):
        if msg.get("role") == "assistant" and msg.get("metadata"):
            execution_mode = msg["metadata"].get("execution_mode", "Unknown")
            break

    story.append(Paragraph(f"<b>Execution Mode:</b> {_escape_xml(execution_mode)}", styles['CustomBody']))

    # Council config info
    if council_config:
        council_models = council_config.get("council_models", [])
        chairman_model = council_config.get("chairman_model", "")
        character_names = council_config.get("character_names", {}) or {}
        chairman_character_name = council_config.get("chairman_character_name")

        # Member list
        member_names = []
        for idx, model_id in enumerate(council_models):
            instance_key = f"{model_id}:{idx}"
            name = character_names.get(instance_key) or character_names.get(str(idx)) or get_display_name(model_id, {})
            member_names.append(name)

        story.append(Paragraph(f"<b>Council Members:</b> {_escape_xml(', '.join(member_names) if member_names else 'None')}", styles['CustomBody']))

        chairman_display = chairman_character_name if chairman_character_name else get_display_name(chairman_model, {})
        story.append(Paragraph(f"<b>Chairman:</b> {_escape_xml(str(chairman_display))}", styles['CustomBody']))

        # Configuration
        story.append(Spacer(1, 8))
        story.append(Paragraph("Council Configuration", styles['ModelName']))

        if council_config.get("council_temperature") is not None:
            story.append(Paragraph(f"Council Temperature: {council_config['council_temperature']}", styles['CustomBody']))
        if council_config.get("chairman_temperature") is not None:
            story.append(Paragraph(f"Chairman Temperature: {council_config['chairman_temperature']}", styles['CustomBody']))
        if council_config.get("stage2_temperature") is not None:
            story.append(Paragraph(f"Stage 2 Temperature: {council_config['stage2_temperature']}", styles['CustomBody']))
        if council_config.get("revision_temperature") is not None:
            story.append(Paragraph(f"Revision Temperature: {council_config['revision_temperature']}", styles['CustomBody']))

        # System prompts (truncated)
        story.append(Spacer(1, 8))
        story.append(Paragraph("System Prompts", styles['ModelName']))
        max_prompt_len = 500

        for stage_name, display_name in [
            ("stage1", "Stage 1"),
            ("stage2", "Stage 2"),
            ("stage5", "Stage 5"),
            ("revision", "Revision")
        ]:
            prompt = council_config.get(f"{stage_name}_prompt")
            if prompt:
                if len(prompt) > max_prompt_len:
                    prompt = prompt[:max_prompt_len] + "..."
                story.append(Paragraph(f"<b>{display_name} Prompt:</b>", styles['CustomBody']))
                story.append(Paragraph(f"<font face=\"Courier\" size=\"9\">{_escape_xml(prompt)}</font>", styles['CustomBody']))

    # Web search info
    for msg in conversation.get("messages", []):
        if msg.get("role") == "assistant" and msg.get("metadata"):
            metadata = msg["metadata"]
            search_query = metadata.get("search_query")

            if search_query:
                story.append(Spacer(1, 8))
                story.append(Paragraph("Web Search", styles['ModelName']))
                story.append(Paragraph(f"Query: {_escape_xml(search_query)}", styles['CustomBody']))
            break


def export_pdf(conversation: Dict[str, Any]) -> bytes:
    """
    Export a conversation as a PDF document.

    Uses ReportLab (pure Python, no system dependencies like WeasyPrint).

    Args:
        conversation: The conversation dict to export

    Returns:
        PDF bytes
    """
    buffer = BytesIO()

    # Create document with A4 page size and margins
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2*cm,
        rightMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm
    )

    # Create styles
    styles = _create_styles()

    # Build story (list of flowables)
    story = []

    # Get council config
    council_config = conversation.get("council_config", {})
    character_names = build_extended_character_names(council_config)
    chairman_character_name = council_config.get("chairman_character_name")

    # Iterate through messages
    for message in conversation.get("messages", []):
        role = message.get("role")

        if role == "user":
            content = message.get("content", "")
            story.append(Paragraph(_escape_xml(content), styles['Title1']))
            story.append(Spacer(1, 12))

        elif role == "assistant":
            # Stage 1 - always present
            stage1 = message.get("stage1", [])
            if stage1:
                _add_stage1_pdf(story, stage1, character_names, styles)

            # Stage 2 - peer rankings
            stage2 = message.get("stage2", [])
            if stage2:
                metadata = message.get("metadata", {})
                aggregate_rankings = metadata.get("aggregate_rankings") if metadata else None
                label_to_model = metadata.get("label_to_model") if metadata else None
                label_to_instance_key = metadata.get("label_to_instance_key") if metadata else None
                _add_stage2_pdf(
                    story,
                    stage2,
                    character_names,
                    aggregate_rankings,
                    label_to_model,
                    label_to_instance_key,
                    styles
                )

            # Stage 3 - revisions
            stage3 = message.get("stage3")
            if stage3:
                _add_stage3_pdf(story, stage3, character_names, styles)

            # Stage 4 - analysis
            stage4 = message.get("stage4")
            if stage4:
                _add_stage4_pdf(story, stage4, character_names, styles)

            # Stage 5 - chairman synthesis
            stage5 = message.get("stage5")
            if stage5:
                _add_stage5_pdf(story, stage5, character_names, chairman_character_name, styles)

    # Metadata section at the end
    _add_metadata_pdf(story, conversation, council_config, styles)

    # Build the PDF
    doc.build(story)

    # Get bytes
    buffer.seek(0)
    return buffer.read()
