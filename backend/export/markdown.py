"""Markdown export generator for conversations."""

from typing import Dict, Any, List, Optional

from .content_processing import (
    get_display_name,
    process_export_content,
    build_extended_character_names
)


def _render_stage1_markdown(
    stage1: List[Dict[str, Any]],
    character_names: Dict[str, str]
) -> str:
    """Render Stage 1 responses as markdown."""
    lines = ["## Stage 1: Initial Responses\n"]

    for idx, response in enumerate(stage1):
        model_id = response.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"

        display_name = get_display_name(model_id, character_names, instance_key)
        lines.append(f"### {display_name}\n")

        content = response.get("response", "")
        error = response.get("error")

        if error:
            lines.append(f"*Error: {error}*\n")
        elif content:
            lines.append(f"{content}\n")

        lines.append("")  # Blank line after each response

    return "\n".join(lines)


def _render_stage2_markdown(
    stage2: List[Dict[str, Any]],
    character_names: Dict[str, str],
    aggregate_rankings: Optional[List[Dict[str, Any]]] = None,
    label_to_model: Optional[Dict[str, str]] = None,
    label_to_instance_key: Optional[Dict[str, str]] = None
) -> str:
    """Render Stage 2 rankings as markdown.

    Args:
        stage2: List of ranking responses
        character_names: Dict mapping instance keys to character names
        aggregate_rankings: Optional aggregate rankings data
        label_to_model: Dict mapping anonymous labels to model IDs (e.g., {"A": "openai:gpt-4"})
        label_to_instance_key: Dict mapping anonymous labels to instance keys
    """
    lines = ["## Stage 2: Peer Rankings\n"]

    for idx, ranking in enumerate(stage2):
        model_id = ranking.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"

        display_name = get_display_name(model_id, character_names, instance_key)
        lines.append(f"### {display_name}'s Ranking\n")

        content = ranking.get("ranking", "")
        error = ranking.get("error")

        if error:
            lines.append(f"*Error: {error}*\n")
        elif content:
            # De-anonymize the ranking content
            processed_content = process_export_content(
                content,
                label_to_model=label_to_model,
                label_to_instance_key=label_to_instance_key,
                character_names=character_names
            )
            lines.append(f"{processed_content}\n")

        lines.append("")  # Blank line

    # Render aggregate rankings if available
    if aggregate_rankings:
        lines.append("**Aggregate Rankings:**\n")
        lines.append("| Rank | Model | Average Score |")
        lines.append("|------|-------|---------------|")

        for idx, item in enumerate(aggregate_rankings, 1):
            model_id = item.get("model", "Unknown")
            instance_key = item.get("instance_key", "")
            avg_rank = item.get("average_rank", 0)

            display_name = get_display_name(model_id, character_names, instance_key)
            lines.append(f"| {idx} | {display_name} | {avg_rank:.1f} |")

        lines.append("")

    return "\n".join(lines)


def _render_stage3_markdown(
    stage3: List[Dict[str, Any]],
    character_names: Dict[str, str]
) -> str:
    """Render Stage 3 (revisions) as markdown."""
    lines = ["## Stage 3: Revisions\n"]

    for idx, response in enumerate(stage3):
        model_id = response.get("model", "Unknown")
        instance_key = f"{model_id}:{idx}"

        display_name = get_display_name(model_id, character_names, instance_key)
        lines.append(f"### {display_name}\n")

        content = response.get("response", "")
        error = response.get("error")

        if error:
            lines.append(f"*Error: {error}*\n")
        elif content:
            lines.append(f"{content}\n")

        lines.append("")

    return "\n".join(lines)


def _render_stage4_markdown(
    stage4: Dict[str, Any],
    character_names: Dict[str, str]
) -> str:
    """Render Stage 4 analysis (truth-check, rankings, highlights) as markdown."""
    lines = ["## Stage 4: Analysis\n"]

    # --- Truth-Check ---
    lines.append("### Truth-Check Results\n")
    truth_check = stage4.get("truth_check") or {}
    if truth_check.get("checked") and truth_check.get("claims"):
        summary = truth_check.get("summary", {})
        verified = summary.get("confirmed", 0)
        flagged = summary.get("disputed", 0)
        unverifiable = summary.get("unaddressed", 0)
        lines.append(f"**Summary:** {verified} confirmed, {flagged} disputed, {unverifiable} unaddressed\n")
        for claim in truth_check["claims"]:
            verdict = claim.get("verdict", "Unknown")
            text = claim.get("text", "")

            # New fields from quick-052 and quick-054
            priority = claim.get("priority", "medium")
            searched = claim.get("searched", True)
            reason = claim.get("reason", "")

            # Build claim line with priority badge
            priority_badge = f"[{priority.upper()}]" if priority != "medium" else ""
            searched_note = " (not verified)" if not searched else ""

            # Start with priority and verdict
            claim_parts = []
            if priority_badge:
                claim_parts.append(priority_badge)
            claim_parts.append(f"[{verdict}]")
            claim_parts.append(text)
            if searched_note:
                claim_parts.append(searched_note)

            claim_line = " ".join(claim_parts)
            lines.append(f"- {claim_line}")

            # Add reason for all verdicts if provided
            if reason:
                lines.append(f"  - Reason: {reason}")
        lines.append("")
    else:
        lines.append("Truth-check was not run for this conversation.\n")

    # --- Rankings ---
    lines.append("### Chairman Rankings\n")
    rankings_data = stage4.get("rankings") or {}
    rankings_list = rankings_data.get("rankings", [])
    if rankings_data.get("checked") and rankings_list:
        lines.append("| Rank | Model | Score | Reasoning | Insight | Clarity |")
        lines.append("|------|-------|-------|-----------|---------|---------|")
        for rank_num, entry in enumerate(rankings_list, 1):
            display_name = get_display_name(entry.get("model", "Unknown"), character_names)
            score = int(entry.get("normalized_score", 0))
            dims = entry.get("dimensions", {})
            reasoning = dims.get("reasoning", {}).get("label", "")
            insight = dims.get("insight", {}).get("label", "")
            clarity = dims.get("clarity", {}).get("label", "")
            lines.append(f"| {rank_num} | {display_name} | {score} | {reasoning} | {insight} | {clarity} |")
        lines.append("")
    else:
        lines.append("Rankings were not produced for this conversation.\n")

    # --- Highlights ---
    lines.append("### Council Highlights\n")
    highlights = stage4.get("highlights") or {}
    agreements = highlights.get("agreements", [])
    disagreements = highlights.get("disagreements", [])
    unique_insights = highlights.get("unique_insights", [])

    if agreements or disagreements or unique_insights:
        if agreements:
            lines.append("**Agreements**\n")
            for item in agreements:
                model_names = ", ".join(
                    get_display_name(m, character_names) for m in item.get("models", [])
                )
                lines.append(f"- {item.get('finding', '')} (models: {model_names})")
            lines.append("")
        if disagreements:
            lines.append("**Disagreements**\n")
            for item in disagreements:
                topic = item.get("topic", "")
                why = item.get("why_they_differ", "")
                positions = item.get("positions", [])
                lines.append(f"- **{topic}**")
                if why:
                    lines.append(f"  - *Why they differ:* {why}")
                for pos in positions:
                    name = get_display_name(pos.get("model_id", "Unknown"), character_names)
                    lines.append(f"  - **{name}:** {pos.get('position_text', '')}")
            lines.append("")
        if unique_insights:
            lines.append("**Unique Insights**\n")
            for item in unique_insights:
                model_name = get_display_name(item.get("model", "Unknown"), character_names)
                lines.append(f"- {item.get('finding', '')} ({model_name})")
            lines.append("")
    else:
        lines.append("No highlights were extracted for this conversation.\n")

    # --- Debates ---
    debates = stage4.get("debates") or []
    completed_debates = [d for d in debates if d.get("transcript")]
    if completed_debates:
        lines.append("### Debates\n")
        for debate in completed_debates:
            title = debate.get("title", "Debate")
            lines.append(f"#### {title}\n")

            participants = debate.get("participants", [])
            if participants:
                parts_str = ", ".join(
                    f"{p.get('name', 'Unknown')} ({p.get('role', '')})"
                    for p in participants
                )
                lines.append(f"**Participants:** {parts_str}\n")

            transcript = debate.get("transcript", [])
            if transcript:
                lines.append("**Transcript**\n")
                for turn in transcript:
                    name = turn.get("name", turn.get("role", "Unknown"))
                    text = turn.get("text", "")
                    lines.append(f"**{name}:** {text}\n")

            verdict = debate.get("verdict") or {}
            summary = verdict.get("summary", "")
            if summary:
                lines.append(f"**Verdict:** {summary}\n")

            lines.append("")

    return "\n".join(lines)


def _render_stage5_markdown(
    stage5: Dict[str, Any],
    character_names: Dict[str, str],
    chairman_character_name: Optional[str] = None
) -> str:
    """Render Stage 5 (chairman synthesis) as markdown."""
    lines = ["## Stage 5: Chairman Synthesis\n"]

    model_id = stage5.get("model", "Unknown")
    display_name = chairman_character_name if chairman_character_name else get_display_name(model_id, character_names)

    lines.append(f"### {display_name}\n")

    content = stage5.get("response", "")
    error = stage5.get("error")

    if error:
        lines.append(f"*Error: {error}*\n")
    elif content:
        lines.append(f"{content}\n")

    lines.append("")

    return "\n".join(lines)


def _render_metadata_markdown(
    conversation: Dict[str, Any],
    council_config: Optional[Dict[str, Any]] = None
) -> str:
    """Render conversation metadata as markdown."""
    lines = ["---\n", "## Conversation Details\n"]

    # Basic info
    created_at = conversation.get("created_at", "Unknown")
    lines.append(f"**Timestamp:** {created_at}\n")

    # Find execution mode from messages or config
    execution_mode = "Unknown"
    if conversation.get("messages"):
        for msg in conversation["messages"]:
            if msg.get("role") == "assistant" and msg.get("metadata"):
                execution_mode = msg["metadata"].get("execution_mode", "Unknown")
                break

    lines.append(f"**Execution Mode:** {execution_mode}\n")

    # Council members and chairman from config
    if council_config:
        council_models = council_config.get("council_models", [])
        chairman_model = council_config.get("chairman_model", "")
        character_names = council_config.get("character_names", {}) or {}
        chairman_character_name = council_config.get("chairman_character_name")

        # Build member list with character names if available
        member_names = []
        for idx, model_id in enumerate(council_models):
            instance_key = f"{model_id}:{idx}"
            name = character_names.get(instance_key) or character_names.get(str(idx)) or get_display_name(model_id, {})
            member_names.append(name)

        lines.append(f"**Council Members:** {', '.join(member_names) if member_names else 'None'}\n")

        chairman_display = chairman_character_name if chairman_character_name else get_display_name(chairman_model, {})
        lines.append(f"**Chairman:** {chairman_display}\n")

        # Temperature settings
        lines.append("\n### Council Configuration\n")
        if council_config.get("council_temperature") is not None:
            lines.append(f"- Council Temperature: {council_config['council_temperature']}\n")
        if council_config.get("chairman_temperature") is not None:
            lines.append(f"- Chairman Temperature: {council_config['chairman_temperature']}\n")
        if council_config.get("stage2_temperature") is not None:
            lines.append(f"- Stage 2 Temperature: {council_config['stage2_temperature']}\n")
        if council_config.get("revision_temperature") is not None:
            lines.append(f"- Revision Temperature: {council_config['revision_temperature']}\n")

        # System prompts
        lines.append("\n### System Prompts\n")

        for stage_name in ["stage1", "stage2", "stage5", "revision"]:
            prompt = council_config.get(f"{stage_name}_prompt")
            if prompt:
                stage_display = stage_name.replace("stage", "Stage ").upper() if stage_name.startswith("stage") else stage_name.title()
                lines.append(f"#### {stage_display} Prompt\n")
                lines.append("```\n" + prompt + "\n```\n")

    # Web search info from messages metadata
    for msg in conversation.get("messages", []):
        if msg.get("role") == "assistant" and msg.get("metadata"):
            metadata = msg["metadata"]
            search_query = metadata.get("search_query")
            search_context = metadata.get("search_context")

            if search_query or search_context:
                lines.append("\n### Web Search\n")
                if search_query:
                    lines.append(f"- Query: {search_query}\n")
                if search_context:
                    # Extract sources from search context
                    sources = []
                    if isinstance(search_context, str):
                        lines.append(f"- Context Used: Yes\n")
                    lines.append("")

    return "\n".join(lines)


def export_markdown(conversation: Dict[str, Any]) -> bytes:
    """
    Export a conversation as a Markdown document.

    Args:
        conversation: The conversation dict to export

    Returns:
        UTF-8 encoded markdown bytes
    """
    lines = []

    # Get council config if available
    council_config = conversation.get("council_config", {})
    character_names = build_extended_character_names(council_config)
    chairman_character_name = council_config.get("chairman_character_name")

    # Iterate through messages
    for message in conversation.get("messages", []):
        role = message.get("role")

        if role == "user":
            # User query as H1 title
            content = message.get("content", "")
            lines.append(f"# {content}\n")

        elif role == "assistant":
            # Stage 1 - always present
            stage1 = message.get("stage1", [])
            if stage1:
                lines.append(_render_stage1_markdown(stage1, character_names))

            # Stage 2 - peer rankings
            stage2 = message.get("stage2", [])
            if stage2:
                metadata = message.get("metadata", {})
                aggregate_rankings = metadata.get("aggregate_rankings") if metadata else None
                label_to_model = metadata.get("label_to_model") if metadata else None
                label_to_instance_key = metadata.get("label_to_instance_key") if metadata else None
                lines.append(_render_stage2_markdown(
                    stage2,
                    character_names,
                    aggregate_rankings,
                    label_to_model,
                    label_to_instance_key
                ))

            # Stage 3 - revisions
            stage3 = message.get("stage3")
            if stage3:
                lines.append(_render_stage3_markdown(stage3, character_names))

            # Stage 4 - analysis (truth-check, rankings, highlights)
            stage4 = message.get("stage4")
            if stage4:
                lines.append(_render_stage4_markdown(stage4, character_names))

            # Stage 5 - chairman synthesis
            stage5 = message.get("stage5")
            if stage5:
                lines.append(_render_stage5_markdown(stage5, character_names, chairman_character_name))

    # Metadata section at the end
    lines.append(_render_metadata_markdown(conversation, council_config))

    markdown_content = "\n".join(lines)
    return markdown_content.encode("utf-8")
