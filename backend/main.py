"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import uuid
import json
import asyncio
import time
import shutil
from pathlib import Path

from . import storage
from .council import generate_conversation_title, generate_search_query, stage1_collect_responses, stage2_collect_rankings, stage5_synthesize_final, calculate_aggregate_rankings, stage3_collect_revisions, PROVIDERS, chairman_follow_up
from .search import perform_web_search, SearchProvider
from .settings import get_settings, update_settings, Settings, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, AVAILABLE_MODELS, SYSTEM_DEFAULT_COUNCIL_CONFIG, save_settings
from .models import CouncilConfig
from .presets import get_presets, save_presets, get_preset, create_preset as create_preset_storage, update_preset as update_preset_storage, delete_preset as delete_preset_storage
from .export import export_conversation, ExportFormat
from .truth_check import stage4_truth_check
from .rankings import stage4_chairman_rankings
from .highlights import extract_highlights
from .debate import select_debate_issues, run_debate

app = FastAPI(title="LLM Council Plus API")

# Enable CORS for local development and network access
# Allow requests from any hostname on ports 5173 and 3000 (frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://.*:(5173|3000)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def backup_data():
    """Backup data directory on startup."""
    src = Path("data")
    backup = Path("backups/latest")
    if backup.exists():
        shutil.rmtree(backup)
    shutil.copytree(src, backup)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    web_search: bool = False
    execution_mode: str = "full"  # 'chat_only', 'chat_ranking', 'revision', 'full'
    truth_check: bool = False  # Enable truth-check for this query
    debate_enabled: bool = False  # Enable debate gateway after Stage 4


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
    council_config: Optional[Dict[str, Any]] = None


class CreatePresetRequest(BaseModel):
    """Request to create or update a preset."""
    name: str
    config: Dict[str, Any]


class BatchExportRequest(BaseModel):
    """Request to batch export presets."""
    preset_names: Optional[List[str]] = None


class BatchImportRequest(BaseModel):
    """Request to batch import presets."""
    presets: List[Dict[str, Any]]
    conflict_mode: str = "skip"


class ExportRequest(BaseModel):
    """Request to export a conversation."""
    format: str  # 'markdown', 'pdf', 'docx'


class FollowUpRequest(BaseModel):
    """Request to send a follow-up question to the chairman."""
    content: str


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


class DeleteSelectedRequest(BaseModel):
    """Request to delete selected conversations."""
    conversation_ids: List[str]


@app.delete("/api/conversations")
async def delete_all_conversations_endpoint():
    """Delete all conversations."""
    count = storage.delete_all_conversations()
    return {"status": "deleted", "count": count}


@app.post("/api/conversations/delete-selected")
async def delete_selected_conversations(request: DeleteSelectedRequest):
    """Delete specific conversations by ID list."""
    result = storage.delete_conversations_by_ids(request.conversation_ids)
    if result["not_found"]:
        # Return partial success with warning
        return {
            "status": "partial",
            "deleted": result["deleted"],
            "not_found": result["not_found"]
        }
    return {"status": "deleted", "deleted": result["deleted"]}


# NOTE: export-all must come BEFORE {conversation_id} to avoid route matching issues
@app.get("/api/conversations/export-all")
async def export_all_conversations():
    """Export all conversations as a single Markdown file."""
    from datetime import datetime

    conversations = storage.get_all_conversations_full()
    if not conversations:
        raise HTTPException(status_code=404, detail="No conversations found")

    # Build markdown content
    md_lines = ["# LLM Council Plus - Conversation Export\n\n"]
    md_lines.append(f"**Exported:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n")
    md_lines.append(f"**Total Conversations:** {len(conversations)}\n\n")
    md_lines.append("---\n\n")

    for conv in conversations:
        md_lines.append(f"## {conv.get('title', 'Untitled')}\n\n")
        md_lines.append(f"**ID:** {conv.get('id', 'unknown')}\n")
        md_lines.append(f"**Created:** {conv.get('created_at', 'unknown')}\n\n")

        for msg in conv.get("messages", []):
            role = msg.get("role", "unknown")
            md_lines.append(f"### {role.capitalize()}\n\n")

            if role == "user":
                md_lines.append(f"{msg.get('content', '')}\n\n")
            else:
                # Stage 1 responses
                stage1 = msg.get("stage1", [])
                if stage1:
                    md_lines.append("#### Stage 1 - Individual Responses\n\n")
                    for i, resp in enumerate(stage1):
                        model = resp.get("model", "Unknown")
                        content = resp.get("response", "")
                        md_lines.append(f"**{model}:**\n\n{content}\n\n")

                # Stage 2 rankings
                stage2 = msg.get("stage2", [])
                if stage2:
                    md_lines.append("#### Stage 2 - Peer Rankings\n\n")
                    for i, rank in enumerate(stage2):
                        model = rank.get("model", "Unknown")
                        content = rank.get("ranking", "")
                        md_lines.append(f"**{model}:**\n\n{content}\n\n")

                # Stage 3 revisions
                stage3 = msg.get("stage3", [])
                if stage3:
                    md_lines.append("#### Stage 3 - Revisions\n\n")
                    for i, rev in enumerate(stage3):
                        model = rev.get("model", "Unknown")
                        content = rev.get("response", "")
                        md_lines.append(f"**{model}:**\n\n{content}\n\n")

                # Stage 5 synthesis
                stage5 = msg.get("stage5")
                if stage5:
                    md_lines.append("#### Final Synthesis\n\n")
                    md_lines.append(f"{stage5.get('response', '')}\n\n")

            md_lines.append("---\n\n")

    markdown_content = "".join(md_lines)
    filename = f"council-export-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.md"

    return StreamingResponse(
        iter([markdown_content.encode("utf-8")]),
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


# Dynamic routes come AFTER static routes
@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted"}


@app.post("/api/conversations/{conversation_id}/export")
async def export_conversation_endpoint(
    conversation_id: str,
    request: ExportRequest
):
    """Export conversation to specified format."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    format_map = {
        'markdown': ExportFormat.MARKDOWN,
        'pdf': ExportFormat.PDF,
        'docx': ExportFormat.DOCX
    }

    if request.format not in format_map:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid format. Must be one of: {list(format_map.keys())}"
        )

    try:
        file_bytes, filename, mime_type = export_conversation(
            conversation,
            format_map[request.format]
        )

        return StreamingResponse(
            iter([file_bytes]),
            media_type=mime_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, body: SendMessageRequest, request: Request):
    """Send a message and stream the 3-stage council process."""
    # Validate execution_mode
    valid_modes = ["chat_only", "chat_ranking", "revision", "full"]
    if body.execution_mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid execution_mode. Must be one of: {valid_modes}"
        )
    
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Initialize variables for metadata
            stage1_results = []
            stage2_results = []
            stage5_result = None
            stage4_result = None
            stage4_rankings_result = None
            stage4_highlights_result = None
            label_to_model = {}
            label_to_instance_key = {}
            aggregate_rankings = {}
            
            # Add user message
            storage.add_user_message(conversation_id, body.content)

            # Capture council config snapshot on first message
            if is_first_message:
                settings = get_settings()
                config_snapshot = CouncilConfig(
                    council_models=settings.council_models,
                    chairman_model=settings.chairman_model,
                    council_temperature=settings.council_temperature,
                    chairman_temperature=settings.chairman_temperature,
                    stage2_temperature=settings.stage2_temperature,
                    revision_temperature=settings.revision_temperature,
                    execution_mode=body.execution_mode,
                    character_names=getattr(settings, 'character_names', None),
                    member_prompts=getattr(settings, 'member_prompts', None),
                    chairman_character_name=getattr(settings, 'chairman_character_name', None),
                    chairman_custom_prompt=getattr(settings, 'chairman_custom_prompt', None),
                    stage1_prompt=settings.stage1_prompt,
                    stage2_prompt=settings.stage2_prompt,
                    stage5_prompt=settings.stage5_prompt,
                    revision_prompt=settings.revision_prompt,
                )
                storage.save_council_config(conversation_id, config_snapshot.model_dump())

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(body.content))

            # Perform web search if requested
            search_context = ""
            search_query = ""
            if body.web_search:
                # Check for disconnect before starting search
                if await request.is_disconnected():
                    print("Client disconnected before web search")
                    raise asyncio.CancelledError("Client disconnected")

                settings = get_settings()
                provider = SearchProvider(settings.search_provider)

                # Set API keys if configured
                if settings.tavily_api_key and provider == SearchProvider.TAVILY:
                    os.environ["TAVILY_API_KEY"] = settings.tavily_api_key
                if settings.brave_api_key and provider == SearchProvider.BRAVE:
                    os.environ["BRAVE_API_KEY"] = settings.brave_api_key
                if settings.firecrawl_api_key:
                    os.environ["FIRECRAWL_API_KEY"] = settings.firecrawl_api_key

                yield f"data: {json.dumps({'type': 'search_start', 'data': {'provider': provider.value}})}\n\n"

                # Check for disconnect before generating search query
                if await request.is_disconnected():
                    print("Client disconnected during search setup")
                    raise asyncio.CancelledError("Client disconnected")

                # Generate search query (passthrough - no AI model needed)
                search_query = generate_search_query(body.content)

                # Check for disconnect before performing search
                if await request.is_disconnected():
                    print("Client disconnected before search execution")
                    raise asyncio.CancelledError("Client disconnected")

                # Run search (now fully async for Tavily/Brave, threaded only for DuckDuckGo)
                search_result = await perform_web_search(
                    search_query,
                    settings.search_results_count,
                    provider,
                    settings.full_content_results,
                    settings.search_keyword_extraction
                )
                search_context = search_result["results"]
                extracted_query = search_result["extracted_query"]
                yield f"data: {json.dumps({'type': 'search_complete', 'data': {'search_query': search_query, 'extracted_query': extracted_query, 'search_context': search_context, 'provider': provider.value}})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            await asyncio.sleep(0.05)
            
            total_models = 0
            
            async for item in stage1_collect_responses(body.content, search_context, request):
                if isinstance(item, int):
                    total_models = item
                    yield f"data: {json.dumps({'type': 'stage1_init', 'total': total_models})}\n\n"
                    continue
                
                stage1_results.append(item)
                yield f"data: {json.dumps({'type': 'stage1_progress', 'data': item, 'count': len(stage1_results), 'total': total_models})}\n\n"
                await asyncio.sleep(0.01)

            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"
            await asyncio.sleep(0.05)

            # Check if any models responded successfully in Stage 1
            if not any(r for r in stage1_results if not r.get('error')):
                error_msg = 'All models failed to respond in Stage 1, likely due to rate limits or API errors. Please try again or adjust your model selection.'
                storage.add_error_message(conversation_id, error_msg)
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
                return # Stop further processing

            # Stage 2: Only if mode is 'chat_ranking', 'revision', or 'full'
            if body.execution_mode in ["chat_ranking", "revision", "full"]:
                yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                await asyncio.sleep(0.05)
                
                # Iterate over the async generator
                async for item in stage2_collect_rankings(body.content, stage1_results, search_context, request):
                    # First item is the combined mapping dict
                    if isinstance(item, dict) and not item.get('model'):
                        label_to_model = item.get("label_to_model", item)  # Fallback for old format
                        label_to_instance_key = item.get("label_to_instance_key", {})
                        # Send init event with total count
                        yield f"data: {json.dumps({'type': 'stage2_init', 'total': len(label_to_model), 'label_to_model': label_to_model, 'label_to_instance_key': label_to_instance_key})}\n\n"
                        continue
                    
                    # Subsequent items are results
                    stage2_results.append(item)
                    
                    # Send progress update
                    print(f"Stage 2 Progress: {len(stage2_results)}/{len(label_to_model)} - {item['model']}")
                    yield f"data: {json.dumps({'type': 'stage2_progress', 'data': item, 'count': len(stage2_results), 'total': len(label_to_model)})}\n\n"
                    await asyncio.sleep(0.01)

                aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model, label_to_instance_key)
                yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'label_to_instance_key': label_to_instance_key, 'aggregate_rankings': aggregate_rankings, 'search_query': search_query, 'search_context': search_context}})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 3 (Revisions): Only if mode is 'revision' or 'full'
            stage3_results = []
            if body.execution_mode in ["revision", "full"]:
                yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                await asyncio.sleep(0.05)

                stage3_total = 0

                async for item in stage3_collect_revisions(
                    stage1_results,
                    stage2_results,
                    label_to_model,
                    request,
                    label_to_instance_key=label_to_instance_key
                ):
                    if isinstance(item, int):
                        stage3_total = item
                        yield f"data: {json.dumps({'type': 'stage3_init', 'total': item})}\n\n"
                        continue

                    stage3_results.append(item)
                    print(f"Stage 3 Progress: {len(stage3_results)}/{stage3_total} - {item['model']}")
                    yield f"data: {json.dumps({'type': 'stage3_progress', 'data': item, 'count': len(stage3_results), 'total': stage3_total})}\n\n"
                    await asyncio.sleep(0.01)

                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_results})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 4: Single 240-second budget shared across truth-check, rankings, and highlights.
            # Each operation gets whatever time remains. Budget starts here regardless of which
            # operations are enabled, so the clock is consistent.
            STAGE4_BUDGET = 240.0
            stage4_start = time.time()

            # Emit stage4_start unconditionally when in full mode (not gated on truth_check)
            if body.execution_mode == "full":
                yield f"data: {json.dumps({'type': 'stage4_start'})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 4 (Truth-Check): Only if mode is 'full' and truth_check is enabled
            if body.execution_mode == "full" and body.truth_check:
                # Check for disconnect before starting Stage 4
                if await request.is_disconnected():
                    print("Client disconnected before Stage 4")
                    raise asyncio.CancelledError("Client disconnected")

                # Use revised responses from Stage 3, or fall back to Stage 1 responses
                responses_for_truth_check = stage3_results if stage3_results else stage1_results
                remaining = max(0.0, STAGE4_BUDGET - (time.time() - stage4_start))
                if remaining > 0:
                    try:
                        stage4_result = await asyncio.wait_for(
                            stage4_truth_check(
                                revised_responses=responses_for_truth_check,
                                settings=get_settings(),
                                request=request
                            ),
                            timeout=remaining
                        )
                    except asyncio.TimeoutError:
                        elapsed = time.time() - stage4_start
                        print(f"Stage 4 truth-check timed out after {elapsed:.0f}s")
                        stage4_result = {
                            "claims": [],
                            "checked": False,
                            "reason": "timeout",
                            "error": "Truth check failed: exceeded timeout budget"
                        }
                else:
                    stage4_result = {
                        "claims": [],
                        "checked": False,
                        "reason": "timeout",
                        "error": "Truth check failed: exceeded timeout budget"
                    }
                yield f"data: {json.dumps({'type': 'stage4_truthcheck_complete', 'data': stage4_result})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 4 Highlights + Rankings: Run in parallel when mode is 'full'
            # stage4_result (truth_check output) is None when truth_check=False; both
            # extract_highlights and stage4_chairman_rankings handle None gracefully.
            if body.execution_mode == "full":
                yield f"data: {json.dumps({'type': 'stage4_highlights_start'})}\n\n"
                yield f"data: {json.dumps({'type': 'stage4_rankings_start'})}\n\n"
                await asyncio.sleep(0.05)

                # Check for disconnect before starting parallel tasks
                if await request.is_disconnected():
                    print("Client disconnected before Stage 4 parallel tasks")
                    raise asyncio.CancelledError("Client disconnected")

                responses_for_highlights = stage3_results if stage3_results else stage1_results
                responses_for_rankings = stage3_results if stage3_results else stage1_results
                remaining = max(0.0, STAGE4_BUDGET - (time.time() - stage4_start))

                async def run_highlights():
                    if remaining <= 0:
                        return {
                            "agreements": [], "disagreements": [], "unique_insights": [],
                            "checked": False, "reason": "timeout"
                        }
                    try:
                        return await asyncio.wait_for(
                            extract_highlights(
                                revised_responses=responses_for_highlights,
                                user_query=body.content,
                                truth_check_results=stage4_result,
                                settings=get_settings()
                            ),
                            timeout=remaining
                        )
                    except asyncio.TimeoutError:
                        elapsed = time.time() - stage4_start
                        print(f"Stage 4 highlights timed out after {elapsed:.0f}s")
                        return {
                            "agreements": [], "disagreements": [], "unique_insights": [],
                            "checked": False, "reason": "timeout"
                        }
                    except Exception as e:
                        print(f"Stage 4 highlights failed: {e}")
                        return {
                            "agreements": [], "disagreements": [], "unique_insights": [],
                            "checked": False, "reason": str(e)
                        }

                async def run_rankings():
                    if remaining <= 0:
                        return {"rankings": [], "checked": False, "reason": "timeout"}
                    try:
                        return await asyncio.wait_for(
                            stage4_chairman_rankings(
                                revised_responses=responses_for_rankings,
                                settings=get_settings(),
                                request=request,
                                truth_check_results=stage4_result,
                                user_query=body.content
                            ),
                            timeout=remaining
                        )
                    except asyncio.TimeoutError:
                        elapsed = time.time() - stage4_start
                        print(f"Stage 4 rankings timed out after {elapsed:.0f}s")
                        return {"rankings": [], "checked": False, "reason": "timeout"}
                    except Exception as e:
                        print(f"Stage 4 rankings failed: {e}")
                        return {"rankings": [], "checked": False, "reason": str(e)}

                highlights_result, rankings_result = await asyncio.gather(
                    run_highlights(),
                    run_rankings()
                )

                stage4_highlights_result = highlights_result
                stage4_rankings_result = rankings_result

                yield f"data: {json.dumps({'type': 'stage4_highlights_complete', 'data': stage4_highlights_result})}\n\n"
                await asyncio.sleep(0.01)
                yield f"data: {json.dumps({'type': 'stage4_rankings_complete', 'data': stage4_rankings_result})}\n\n"
                await asyncio.sleep(0.05)

            # Debate Gateway: Issue selection (only if debate enabled in full mode)
            # NOTE: In this phase, gateway_ready is emitted and Stage 5 proceeds immediately
            # with empty debates. Phase 22 (frontend) implements the pause-and-wait UX where
            # the user triggers debates and clicks "Proceed" before Stage 5 runs.
            gateway_issues = []
            debate_results = []  # Will be populated by frontend calling /debate endpoint
            if body.execution_mode == "full" and body.debate_enabled:
                try:
                    stage3_for_debate = stage3_results if stage3_results else stage1_results
                    print(f"[DEBATE-GATEWAY] highlights has {len((stage4_highlights_result or {}).get('disagreements', []))} disagreements")
                    print(f"[DEBATE-GATEWAY] stage3_for_debate has {len(stage3_for_debate)} results")
                    gateway_issues = await select_debate_issues(
                        highlights=stage4_highlights_result,
                        stage3_results=stage3_for_debate,
                        settings=get_settings()
                    )
                    print(f"[DEBATE-GATEWAY] select_debate_issues returned {len(gateway_issues)} issues")
                except Exception as e:
                    print(f"[DEBATE-GATEWAY] Issue selection EXCEPTION: {e}")
                    import traceback
                    traceback.print_exc()
                    gateway_issues = []

                # Emit gateway_ready event with issues for frontend (only if there are issues)
                if gateway_issues:
                    print(f"[DEBATE-GATEWAY] Emitting gateway_ready with {len(gateway_issues)} issues")
                    yield f"data: {json.dumps({'type': 'gateway_ready', 'data': {'issues': gateway_issues}})}\n\n"
                    await asyncio.sleep(0.05)

            # Build metadata now (needed for early save below and/or final save)
            metadata = {
                "execution_mode": body.execution_mode,
            }
            if body.execution_mode in ["chat_ranking", "revision", "full"]:
                metadata["label_to_model"] = label_to_model
                metadata["label_to_instance_key"] = label_to_instance_key
                metadata["aggregate_rankings"] = aggregate_rankings
            if search_context:
                metadata["search_context"] = search_context
            if search_query:
                metadata["search_query"] = search_query

            # Early save: persist stage1-4 + metadata BEFORE Stage 5 starts so that
            # the /debate endpoint can load the conversation while Stage 5 is running.
            # This only applies when debates are enabled (gateway_issues present).
            debate_early_saved = False
            if body.execution_mode == "full" and gateway_issues:
                early_stage4 = {
                    "truth_check": stage4_result,
                    "rankings": stage4_rankings_result,
                    "highlights": stage4_highlights_result,
                    "gateway_issues": gateway_issues,
                    "debates": [],  # /debate endpoint fills this as debates complete
                }
                storage.add_assistant_message(
                    conversation_id,
                    stage1_results,
                    stage2_results,
                    stage3_results,
                    None,  # stage5 not available yet
                    metadata,
                    stage4=early_stage4,
                )
                debate_early_saved = True

            # Stage 5 (Synthesis): Only if mode is 'full' AND not deferred for debate gateway
            # When debate_early_saved=True, Stage 5 is triggered later via POST /api/conversations/{id}/stage5
            stage5_result = None
            if body.execution_mode == "full" and not debate_early_saved:
                yield f"data: {json.dumps({'type': 'stage5_start'})}\n\n"
                await asyncio.sleep(0.05)

                # Check for disconnect before starting Stage 5
                if await request.is_disconnected():
                    print("Client disconnected before Stage 5")
                    raise asyncio.CancelledError("Client disconnected")

                # Chairman receives revised responses if available, else original Stage 1
                responses_for_chairman = stage3_results if stage3_results else stage1_results
                stage5_result = await stage5_synthesize_final(
                    body.content,
                    responses_for_chairman,
                    stage2_results,
                    search_context,
                    label_to_model,
                    label_to_instance_key,
                    stage4_truth_check=stage4_result,
                    stage4_highlights=stage4_highlights_result,
                    debates=debate_results,
                )
                yield f"data: {json.dumps({'type': 'stage5_complete', 'data': stage5_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                try:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                except Exception as e:
                    print(f"Error waiting for title task: {e}")

            if debate_early_saved:
                # Early save already persisted stage1-4. Stage 5 will be written by
                # the /api/conversations/{id}/stage5 endpoint when user clicks "Proceed".
                # Do NOT call update_last_message_stage5 here — stage5 hasn't run yet.
                pass
            else:
                # Normal path: single save after everything completes
                stage4_storage = None
                if body.execution_mode == "full":
                    stage4_storage = {
                        "truth_check": stage4_result,
                        "rankings": stage4_rankings_result,
                        "highlights": stage4_highlights_result,
                    }
                storage.add_assistant_message(
                    conversation_id,
                    stage1_results,
                    stage2_results if body.execution_mode in ["chat_ranking", "revision", "full"] else None,
                    stage3_results if body.execution_mode in ["revision", "full"] else None,
                    stage5_result if body.execution_mode == "full" else None,
                    metadata,
                    stage4=stage4_storage,
                )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except asyncio.CancelledError:
            print(f"Stream cancelled for conversation {conversation_id}")
            # Even if cancelled, try to save the title if it's ready or nearly ready
            if title_task:
                try:
                    # Give it a small grace period to finish if it's close
                    title = await asyncio.wait_for(title_task, timeout=2.0)
                    storage.update_conversation_title(conversation_id, title)
                    print(f"Saved title despite cancellation: {title}")
                except Exception as e:
                    print(f"Could not save title during cancellation: {e}")
            raise
        except Exception as e:
            print(f"Stream error: {e}")
            # Save error to conversation history
            storage.add_error_message(conversation_id, f"Error: {str(e)}")
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/debate/{conversation_id}/{issue_idx}")
async def debate_issue(conversation_id: str, issue_idx: int, request: Request):
    """Run an authentic debate for a specific issue and stream results via SSE."""
    # Load conversation
    conversation = storage.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Get the latest assistant message
    messages = conversation.get("messages", [])
    assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
    if not assistant_msgs:
        raise HTTPException(status_code=400, detail="No assistant messages found")
    last_msg = assistant_msgs[-1]

    # Extract stage4 data (must have highlights with issues already selected)
    stage4 = last_msg.get("stage4", {})
    if not stage4:
        raise HTTPException(status_code=400, detail="No Stage 4 data found")

    # Get debates array (may already have some from prior runs)
    debates = stage4.get("debates", [])

    # If already debated and completed, return cached result without re-running
    existing = next((d for d in debates if d.get("idx") == issue_idx), None)
    if existing and existing.get("status") == "completed":
        async def existing_stream():
            yield f"data: {json.dumps({'type': 'debate_done', 'data': existing})}\n\n"
        return StreamingResponse(existing_stream(), media_type="text/event-stream")

    # Get the issue info from gateway_issues (stored in stage4 by the gateway_ready flow)
    gateway_issues = stage4.get("gateway_issues", [])
    if issue_idx >= len(gateway_issues):
        raise HTTPException(status_code=400, detail=f"Issue index {issue_idx} out of range")
    issue = gateway_issues[issue_idx]

    # Get Stage 3 results for participant context (fall back to Stage 1 if Stage 3 not present)
    stage3_results = last_msg.get("stage3", last_msg.get("stage1", []))

    # Extract original user query to anchor debate turns to the topic
    user_msg = next((m for m in messages if m.get("role") == "user"), None)
    original_query = user_msg.get("content", "") if user_msg else ""

    settings = get_settings()

    async def debate_stream():
        async for event in run_debate(
            conversation_id=conversation_id,
            issue_idx=issue_idx,
            issue=issue,
            stage3_results=stage3_results,
            settings=settings,
            request=request,
            original_query=original_query,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(debate_stream(), media_type="text/event-stream")


@app.post("/api/conversations/{conversation_id}/stage5")
async def run_stage5_endpoint(conversation_id: str, request: Request):
    """
    Run Stage 5 chairman synthesis on demand for conversations where debate mode was active.
    Called by the frontend when the user clicks "Proceed to Chairman Synthesis".
    Streams SSE: stage5_start → stage5_complete → title_complete → complete.
    """
    conversation = storage.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", [])
    user_msgs = [m for m in messages if m.get("role") == "user"]
    assistant_msgs = [m for m in messages if m.get("role") == "assistant"]

    if not user_msgs or not assistant_msgs:
        raise HTTPException(status_code=400, detail="Conversation missing user or assistant messages")

    last_user = user_msgs[-1]
    last_assistant = assistant_msgs[-1]

    async def stage5_stream():
        try:
            # Idempotency check: if stage5 already exists, return cached result
            if last_assistant.get("stage5"):
                print(f"[STAGE5-ENDPOINT] stage5 already exists for {conversation_id}, returning cached")
                yield f"data: {json.dumps({'type': 'stage5_complete', 'data': last_assistant['stage5']})}\n\n"
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                return

            if await request.is_disconnected():
                return

            # Reconstruct all context from storage
            user_query = last_user.get("content", "")
            stage1_results = last_assistant.get("stage1", [])
            stage2_results = last_assistant.get("stage2", [])
            stage3_results = last_assistant.get("stage3")  # may be None
            stage4 = last_assistant.get("stage4", {})
            metadata = last_assistant.get("metadata", {})

            # Debate data — may be [] if user skipped all debates (handled gracefully)
            debates = stage4.get("debates", [])

            # Reconstruct ephemeral context from metadata (stored during early save)
            search_context = metadata.get("search_context", "")
            label_to_model = metadata.get("label_to_model", {})
            label_to_instance_key = metadata.get("label_to_instance_key", {})

            # Stage 4 sub-results
            stage4_truth_check = stage4.get("truth_check")
            stage4_highlights = stage4.get("highlights")

            # Chairman uses stage3 if available, else stage1
            responses_for_chairman = stage3_results if stage3_results else stage1_results

            print(f"[STAGE5-ENDPOINT] Running stage5 for {conversation_id} with {len(debates)} debates")

            yield f"data: {json.dumps({'type': 'stage5_start'})}\n\n"
            await asyncio.sleep(0.05)

            if await request.is_disconnected():
                return

            stage5_result = await stage5_synthesize_final(
                user_query,
                responses_for_chairman,
                stage2_results,
                search_context,
                label_to_model,
                label_to_instance_key,
                stage4_truth_check=stage4_truth_check,
                stage4_highlights=stage4_highlights,
                debates=debates,
            )

            yield f"data: {json.dumps({'type': 'stage5_complete', 'data': stage5_result})}\n\n"

            # Persist stage5 to storage (safe: only touches stage5 field)
            storage.update_last_message_stage5(conversation_id, stage5_result)

            # Emit title_complete to trigger sidebar reload
            # Title was already generated by the main stream — just re-emit it
            title = conversation.get("title", "")
            yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except asyncio.CancelledError:
            print(f"[STAGE5-ENDPOINT] Stream cancelled for {conversation_id}")
        except Exception as e:
            print(f"[STAGE5-ENDPOINT] Error for {conversation_id}: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        stage5_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/conversations/{conversation_id}/follow-up")
async def chairman_follow_up_endpoint(
    conversation_id: str,
    request: Request,
    body: FollowUpRequest,
):
    """
    Send a follow-up question to the chairman after a completed deliberation.
    Streams SSE: follow_up_start → follow_up_chunk → follow_up_complete → complete.
    Max 5 follow-ups per deliberation thread (HTTP 429 if exceeded).
    """
    conversation = storage.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages", [])

    # Find the last non-follow-up assistant message that has stage5 set
    anchor_index = None
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        if m.get("role") == "assistant" and m.get("stage5") and not m.get("type"):
            anchor_index = i
            break

    if anchor_index is None:
        raise HTTPException(status_code=400, detail="No completed deliberation found")

    # The user message immediately before the anchor is the original query
    original_query = ""
    for i in range(anchor_index - 1, -1, -1):
        if messages[i].get("role") == "user" and not messages[i].get("type"):
            original_query = messages[i].get("content", "")
            break

    stage5_verdict = messages[anchor_index]["stage5"].get("response", "")

    # Messages after the anchor
    post_anchor = messages[anchor_index + 1:]

    # Count follow-up user messages after anchor
    follow_up_user_count = sum(
        1 for m in post_anchor
        if m.get("role") == "user" and m.get("type") == "follow_up"
    )
    if follow_up_user_count >= 5:
        raise HTTPException(status_code=429, detail="Follow-up limit reached")

    # Collect last 3 follow-up exchanges (user+assistant pairs)
    follow_up_history = []
    i = 0
    while i < len(post_anchor):
        m = post_anchor[i]
        if m.get("role") == "user" and m.get("type") == "follow_up":
            question = m.get("content", "")
            answer = ""
            if i + 1 < len(post_anchor):
                next_m = post_anchor[i + 1]
                if next_m.get("role") == "assistant" and next_m.get("type") == "follow_up":
                    answer = (next_m.get("stage5") or {}).get("response", "")
                    i += 1
            follow_up_history.append({"question": question, "answer": answer})
        i += 1
    follow_up_history = follow_up_history[-3:]

    # Persist new user message to storage
    conversation["messages"].append({
        "role": "user",
        "content": body.content,
        "type": "follow_up",
    })
    storage.save_conversation(conversation)

    async def follow_up_stream():
        full_text = ""
        model_id = ""
        try:
            if await request.is_disconnected():
                return

            yield f"data: {json.dumps({'type': 'follow_up_start', 'data': {}})}\n\n"
            await asyncio.sleep(0.05)

            if await request.is_disconnected():
                return

            result = await chairman_follow_up(
                original_query=original_query,
                stage5_verdict=stage5_verdict,
                follow_up_history=follow_up_history,
                new_question=body.content,
            )

            model_id = result.get("model", "")
            full_text = result.get("response", "")

            # Emit chunks word-by-word for streaming feel
            words = full_text.split(" ")
            chunk_size = 5
            for j in range(0, len(words), chunk_size):
                if await request.is_disconnected():
                    return
                chunk = " ".join(words[j:j + chunk_size])
                if j + chunk_size < len(words):
                    chunk += " "
                yield f"data: {json.dumps({'type': 'follow_up_chunk', 'data': {'text': chunk}})}\n\n"

            yield f"data: {json.dumps({'type': 'follow_up_complete', 'data': {'model': model_id, 'response': full_text}})}\n\n"

            # Persist assistant follow-up message
            fresh = storage.get_conversation(conversation_id)
            if fresh:
                fresh["messages"].append({
                    "role": "assistant",
                    "type": "follow_up",
                    "stage5": {"model": model_id, "response": full_text},
                })
                storage.save_conversation(fresh)

            yield f"data: {json.dumps({'type': 'complete', 'data': {}})}\n\n"

        except asyncio.CancelledError:
            print(f"[FOLLOW-UP] Stream cancelled for {conversation_id}")
        except Exception as e:
            print(f"[FOLLOW-UP] Error for {conversation_id}: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        follow_up_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


class UpdateSettingsRequest(BaseModel):
    """Request to update settings."""
    search_provider: Optional[str] = None
    search_keyword_extraction: Optional[str] = None
    ollama_base_url: Optional[str] = None
    search_results_count: Optional[int] = None
    full_content_results: Optional[int] = None

    # Custom OpenAI-compatible endpoint
    custom_endpoint_name: Optional[str] = None
    custom_endpoint_url: Optional[str] = None
    custom_endpoint_api_key: Optional[str] = None

    # API Keys
    tavily_api_key: Optional[str] = None
    brave_api_key: Optional[str] = None
    truth_check_provider: Optional[str] = None
    firecrawl_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    mistral_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    glm_api_key: Optional[str] = None
    kimi_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    perplexity_api_key: Optional[str] = None

    # Enabled Providers
    enabled_providers: Optional[Dict[str, bool]] = None
    direct_provider_toggles: Optional[Dict[str, bool]] = None

    # Council Configuration (unified)
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None
    
    # Remote/Local filters
    council_member_filters: Optional[Dict[int, str]] = None
    chairman_filter: Optional[str] = None
    search_query_filter: Optional[str] = None

    # Temperature Settings
    council_temperature: Optional[float] = None
    chairman_temperature: Optional[float] = None
    stage2_temperature: Optional[float] = None

    # Execution Mode
    execution_mode: Optional[str] = None

    # System Prompts
    stage1_prompt: Optional[str] = None
    stage2_prompt: Optional[str] = None
    stage5_prompt: Optional[str] = None
    revision_prompt: Optional[str] = None
    debate_turn_primary_a_prompt: Optional[str] = None
    debate_turn_rebuttal_prompt: Optional[str] = None
    debate_verdict_prompt: Optional[str] = None

    # Character Names and Member Prompts
    character_names: Optional[Dict[str, str]] = None
    member_prompts: Optional[Dict[str, str]] = None

    # Chairman Character Name and Custom Prompt
    chairman_character_name: Optional[str] = None
    chairman_custom_prompt: Optional[str] = None

    # Default Member Role (fallback for members without custom prompts)
    default_member_role: Optional[str] = None



class TestTavilyRequest(BaseModel):
    """Request to test Tavily API key."""
    api_key: str | None = None


@app.get("/api/settings")
async def get_app_settings():
    """Get current application settings."""
    settings = get_settings()
    return {
        "search_provider": settings.search_provider,
        "search_keyword_extraction": settings.search_keyword_extraction,
        "ollama_base_url": settings.ollama_base_url,
        "search_results_count": settings.search_results_count,
        "full_content_results": settings.full_content_results,

        # Custom Endpoint
        "custom_endpoint_name": settings.custom_endpoint_name,
        "custom_endpoint_url": settings.custom_endpoint_url,
        # Don't send the API key to frontend for security

        # API Key Status
        "tavily_api_key_set": bool(settings.tavily_api_key),
        "brave_api_key_set": bool(settings.brave_api_key),
        "firecrawl_api_key_set": bool(settings.firecrawl_api_key),
        "openrouter_api_key_set": bool(settings.openrouter_api_key),
        "openai_api_key_set": bool(settings.openai_api_key),
        "anthropic_api_key_set": bool(settings.anthropic_api_key),
        "google_api_key_set": bool(settings.google_api_key),
        "perplexity_api_key_set": bool(settings.perplexity_api_key),
        "mistral_api_key_set": bool(settings.mistral_api_key),
        "deepseek_api_key_set": bool(settings.deepseek_api_key),
        "glm_api_key_set": bool(settings.glm_api_key),
        "kimi_api_key_set": bool(settings.kimi_api_key),
        "groq_api_key_set": bool(settings.groq_api_key),
        "custom_endpoint_api_key_set": bool(settings.custom_endpoint_api_key),

        # Enabled Providers
        "enabled_providers": settings.enabled_providers,
        "direct_provider_toggles": settings.direct_provider_toggles,

        # Council Configuration (unified)
        "council_models": settings.council_models,
        "chairman_model": settings.chairman_model,

        # Remote/Local filters
        "council_member_filters": settings.council_member_filters,
        "chairman_filter": settings.chairman_filter,
        "search_query_filter": settings.search_query_filter,

        # Temperature Settings
        "council_temperature": settings.council_temperature,
        "chairman_temperature": settings.chairman_temperature,
        "stage2_temperature": settings.stage2_temperature,

        # Prompts
        "stage1_prompt": settings.stage1_prompt,
        "stage2_prompt": settings.stage2_prompt,
        "stage5_prompt": settings.stage5_prompt,
        "revision_prompt": settings.revision_prompt,
        "debate_turn_primary_a_prompt": settings.debate_turn_primary_a_prompt,
        "debate_turn_rebuttal_prompt": settings.debate_turn_rebuttal_prompt,
        "debate_verdict_prompt": settings.debate_verdict_prompt,

        # Character Names and Member Prompts
        "character_names": settings.character_names,
        "member_prompts": settings.member_prompts,

        # Chairman Character Name and Custom Prompt
        "chairman_character_name": settings.chairman_character_name,
        "chairman_custom_prompt": settings.chairman_custom_prompt,

        # Default Member Role
        "default_member_role": settings.default_member_role,

        # Truth Check Provider
        "truth_check_provider": settings.truth_check_provider,
    }



@app.get("/api/settings/defaults")
async def get_default_settings():
    """Get default model settings."""
    from .prompts import (
        STAGE1_PROMPT_DEFAULT,
        STAGE2_PROMPT_DEFAULT,
        STAGE5_PROMPT_DEFAULT,
        REVISION_PROMPT_DEFAULT,
        TITLE_PROMPT_DEFAULT,
        DEBATE_TURN_PRIMARY_A,
        DEBATE_TURN_REBUTTAL,
        DEBATE_VERDICT_PROMPT,
    )
    from .settings import DEFAULT_ENABLED_PROVIDERS
    return {
        "council_models": DEFAULT_COUNCIL_MODELS,
        "chairman_model": DEFAULT_CHAIRMAN_MODEL,
        "enabled_providers": DEFAULT_ENABLED_PROVIDERS,
        "stage1_prompt": STAGE1_PROMPT_DEFAULT,
        "stage2_prompt": STAGE2_PROMPT_DEFAULT,
        "stage5_prompt": STAGE5_PROMPT_DEFAULT,
        "revision_prompt": REVISION_PROMPT_DEFAULT,
        "debate_turn_primary_a_prompt": DEBATE_TURN_PRIMARY_A,
        "debate_turn_rebuttal_prompt": DEBATE_TURN_REBUTTAL,
        "debate_verdict_prompt": DEBATE_VERDICT_PROMPT,
    }


@app.post("/api/settings/reset-council")
async def reset_council_config():
    """
    Reset council configuration to system defaults.
    Bypasses validation to allow empty/blank state.
    """
    # Get current settings
    settings = get_settings()

    # Apply defaults directly (bypass validation)
    settings.council_models = ["", ""]
    settings.chairman_model = ""
    settings.council_temperature = 0.5
    settings.chairman_temperature = 0.4
    settings.stage2_temperature = 0.3
    settings.character_names = None
    settings.member_prompts = None
    settings.chairman_character_name = None
    settings.chairman_custom_prompt = None

    # Save to file
    save_settings(settings)

    return {"success": True, "config": SYSTEM_DEFAULT_COUNCIL_CONFIG}


@app.put("/api/settings")
async def update_app_settings(request: UpdateSettingsRequest):
    """Update application settings."""
    updates = {}

    if request.search_provider is not None:
        # Validate provider
        try:
            provider = SearchProvider(request.search_provider)
            updates["search_provider"] = provider
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid search provider. Must be one of: {[p.value for p in SearchProvider]}"
            )

    if request.search_keyword_extraction is not None:
        if request.search_keyword_extraction not in ["direct", "yake"]:
             raise HTTPException(
                status_code=400,
                detail="Invalid keyword extraction mode. Must be 'direct' or 'yake'"
            )
        updates["search_keyword_extraction"] = request.search_keyword_extraction

    if "ollama_base_url" in request.model_fields_set:
        updates["ollama_base_url"] = request.ollama_base_url

    # Custom endpoint - allow clearing with null
    if "custom_endpoint_name" in request.model_fields_set:
        updates["custom_endpoint_name"] = request.custom_endpoint_name
    if "custom_endpoint_url" in request.model_fields_set:
        updates["custom_endpoint_url"] = request.custom_endpoint_url
    if "custom_endpoint_api_key" in request.model_fields_set:
        updates["custom_endpoint_api_key"] = request.custom_endpoint_api_key

    if request.search_results_count is not None:
        if request.search_results_count < 1 or request.search_results_count > 10:
            raise HTTPException(
                status_code=400,
                detail="search_results_count must be between 1 and 10"
            )
        updates["search_results_count"] = request.search_results_count

    if request.full_content_results is not None:
        # Validate range
        if request.full_content_results < 0 or request.full_content_results > 10:
            raise HTTPException(
                status_code=400,
                detail="full_content_results must be between 0 and 10"
            )
        updates["full_content_results"] = request.full_content_results

    # Prompt updates
    if request.stage1_prompt is not None:
        updates["stage1_prompt"] = request.stage1_prompt
    if request.stage2_prompt is not None:
        updates["stage2_prompt"] = request.stage2_prompt
    if request.stage5_prompt is not None:
        updates["stage5_prompt"] = request.stage5_prompt
    if request.revision_prompt is not None:
        updates["revision_prompt"] = request.revision_prompt
    if request.debate_turn_primary_a_prompt is not None:
        updates["debate_turn_primary_a_prompt"] = request.debate_turn_primary_a_prompt
    if request.debate_turn_rebuttal_prompt is not None:
        updates["debate_turn_rebuttal_prompt"] = request.debate_turn_rebuttal_prompt
    if request.debate_verdict_prompt is not None:
        updates["debate_verdict_prompt"] = request.debate_verdict_prompt

    # API Keys - check if field was explicitly set (allows clearing with null)
    if "tavily_api_key" in request.model_fields_set:
        updates["tavily_api_key"] = request.tavily_api_key
        # Also set in environment for immediate use
        if request.tavily_api_key:
            os.environ["TAVILY_API_KEY"] = request.tavily_api_key

    if "brave_api_key" in request.model_fields_set:
        updates["brave_api_key"] = request.brave_api_key
        # Also set in environment for immediate use
        if request.brave_api_key:
            os.environ["BRAVE_API_KEY"] = request.brave_api_key

    if "firecrawl_api_key" in request.model_fields_set:
        updates["firecrawl_api_key"] = request.firecrawl_api_key
        if request.firecrawl_api_key:
            os.environ["FIRECRAWL_API_KEY"] = request.firecrawl_api_key

    if "openrouter_api_key" in request.model_fields_set:
        updates["openrouter_api_key"] = request.openrouter_api_key

    # Direct Provider Keys
    if "openai_api_key" in request.model_fields_set:
        updates["openai_api_key"] = request.openai_api_key
    if "anthropic_api_key" in request.model_fields_set:
        updates["anthropic_api_key"] = request.anthropic_api_key
    if "google_api_key" in request.model_fields_set:
        updates["google_api_key"] = request.google_api_key
    if "mistral_api_key" in request.model_fields_set:
        updates["mistral_api_key"] = request.mistral_api_key
    if "deepseek_api_key" in request.model_fields_set:
        updates["deepseek_api_key"] = request.deepseek_api_key
    if "glm_api_key" in request.model_fields_set:
        updates["glm_api_key"] = request.glm_api_key
    if "kimi_api_key" in request.model_fields_set:
        updates["kimi_api_key"] = request.kimi_api_key
    if "groq_api_key" in request.model_fields_set:
        updates["groq_api_key"] = request.groq_api_key
    if "perplexity_api_key" in request.model_fields_set:
        updates["perplexity_api_key"] = request.perplexity_api_key

    # Enabled Providers
    if request.enabled_providers is not None:
        updates["enabled_providers"] = request.enabled_providers

    if request.direct_provider_toggles is not None:
        updates["direct_provider_toggles"] = request.direct_provider_toggles

    # Council Configuration (unified)
    if request.council_models is not None:
        # Validate that at least two models are selected
        if len(request.council_models) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least two council models must be selected"
            )
        if len(request.council_models) > 8:
            raise HTTPException(
                status_code=400,
                detail="Maximum of 8 council models allowed"
            )
        updates["council_models"] = request.council_models

    if request.chairman_model is not None:
        updates["chairman_model"] = request.chairman_model
        
    # Remote/Local filters
    if request.council_member_filters is not None:
        updates["council_member_filters"] = request.council_member_filters
    if request.chairman_filter is not None:
        updates["chairman_filter"] = request.chairman_filter
    if request.search_query_filter is not None:
        updates["search_query_filter"] = request.search_query_filter

    # Temperature Settings
    if request.council_temperature is not None:
        updates["council_temperature"] = request.council_temperature
    if request.chairman_temperature is not None:
        updates["chairman_temperature"] = request.chairman_temperature
    if request.stage2_temperature is not None:
        updates["stage2_temperature"] = request.stage2_temperature

    # Prompts   # Execution Mode
    if request.execution_mode is not None:
        valid_modes = ["chat_only", "chat_ranking", "revision", "full"]
        if request.execution_mode not in valid_modes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid execution_mode. Must be one of: {valid_modes}"
            )
        updates["execution_mode"] = request.execution_mode

    # Character Names
    if request.character_names is not None:
        updates["character_names"] = request.character_names

    # Member Prompts
    if request.member_prompts is not None:
        updates["member_prompts"] = request.member_prompts

    # Chairman Character Name and Custom Prompt
    # Always include to allow clearing (frontend sends null for empty)
    updates["chairman_character_name"] = request.chairman_character_name
    updates["chairman_custom_prompt"] = request.chairman_custom_prompt

    # Default Member Role
    if request.default_member_role is not None:
        updates["default_member_role"] = request.default_member_role

    # Truth Check Provider
    if request.truth_check_provider is not None:
        try:
            provider = SearchProvider(request.truth_check_provider)
            updates["truth_check_provider"] = provider.value
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid truth_check_provider. Must be one of: {[p.value for p in SearchProvider]}"
            )

    if updates:
        settings = update_settings(**updates)
    else:
        settings = get_settings()

    return {
        "search_provider": settings.search_provider,
        "search_keyword_extraction": settings.search_keyword_extraction,
        "ollama_base_url": settings.ollama_base_url,
        "search_results_count": settings.search_results_count,
        "full_content_results": settings.full_content_results,

        # Custom Endpoint
        "custom_endpoint_name": settings.custom_endpoint_name,
        "custom_endpoint_url": settings.custom_endpoint_url,

        # API Key Status
        "tavily_api_key_set": bool(settings.tavily_api_key),
        "brave_api_key_set": bool(settings.brave_api_key),
        "firecrawl_api_key_set": bool(settings.firecrawl_api_key),
        "openrouter_api_key_set": bool(settings.openrouter_api_key),
        "openai_api_key_set": bool(settings.openai_api_key),
        "anthropic_api_key_set": bool(settings.anthropic_api_key),
        "google_api_key_set": bool(settings.google_api_key),
        "perplexity_api_key_set": bool(settings.perplexity_api_key),
        "mistral_api_key_set": bool(settings.mistral_api_key),
        "deepseek_api_key_set": bool(settings.deepseek_api_key),
        "glm_api_key_set": bool(settings.glm_api_key),
        "kimi_api_key_set": bool(settings.kimi_api_key),
        "groq_api_key_set": bool(settings.groq_api_key),
        "custom_endpoint_api_key_set": bool(settings.custom_endpoint_api_key),

        # Enabled Providers
        "enabled_providers": settings.enabled_providers,
        "direct_provider_toggles": settings.direct_provider_toggles,

        # Council Configuration (unified)
        "council_models": settings.council_models,
        "chairman_model": settings.chairman_model,

        # Remote/Local filters
        "council_member_filters": settings.council_member_filters,
        "chairman_filter": settings.chairman_filter,

        # Prompts
        "stage1_prompt": settings.stage1_prompt,
        "stage2_prompt": settings.stage2_prompt,
        "stage5_prompt": settings.stage5_prompt,
        "revision_prompt": settings.revision_prompt,
        "debate_turn_primary_a_prompt": settings.debate_turn_primary_a_prompt,
        "debate_turn_rebuttal_prompt": settings.debate_turn_rebuttal_prompt,
        "debate_verdict_prompt": settings.debate_verdict_prompt,

        # Character Names and Member Prompts
        "character_names": settings.character_names,
        "member_prompts": settings.member_prompts,

        # Chairman Character Name and Custom Prompt
        "chairman_character_name": settings.chairman_character_name,
        "chairman_custom_prompt": settings.chairman_custom_prompt,

        # Default Member Role
        "default_member_role": settings.default_member_role,

        # Truth Check Provider
        "truth_check_provider": settings.truth_check_provider,
    }


@app.get("/api/models")
async def get_models():
    """Get available models for council selection."""
    from .openrouter import fetch_models
    
    # Try dynamic fetch first
    dynamic_models = await fetch_models()
    if dynamic_models:
        return {"models": dynamic_models}
        
    # Fallback to static list
    return {"models": AVAILABLE_MODELS}


@app.get("/api/models/direct")
async def get_direct_models():
    """Get available models from all configured direct providers."""
    all_models = []
    
    # Iterate over all providers
    for provider_id, provider in PROVIDERS.items():
        # Skip OpenRouter and Ollama as they are handled separately
        if provider_id in ["openrouter", "ollama", "hybrid"]:
            continue
            
        try:
            # Fetch models from provider
            models = await provider.get_models()
            all_models.extend(models)
        except Exception as e:
            print(f"Error fetching models for {provider_id}: {e}")
            
    return all_models


@app.post("/api/settings/test-tavily")
async def test_tavily_api(request: TestTavilyRequest):
    """Test Tavily API key with a simple search."""
    import httpx
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": request.api_key or settings.tavily_api_key,
                    "query": "test",
                    "max_results": 1,
                    "search_depth": "basic",
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestBraveRequest(BaseModel):
    """Request to test Brave API key."""
    api_key: str | None = None


@app.post("/api/settings/test-brave")
async def test_brave_api(request: TestBraveRequest):
    """Test Brave API key with a simple search."""
    import httpx
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": "test", "count": 1},
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": request.api_key or settings.brave_api_key,
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401 or response.status_code == 403:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestFirecrawlRequest(BaseModel):
    api_key: str | None = None


@app.post("/api/settings/test-firecrawl")
async def test_firecrawl_api(request: TestFirecrawlRequest):
    """Test Firecrawl API key by scraping a simple URL."""
    import httpx
    settings = get_settings()
    api_key = request.api_key or settings.firecrawl_api_key
    if not api_key:
        return {"success": False, "message": "No API key provided"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.firecrawl.dev/v1/scrape",
                json={"url": "https://example.com", "formats": ["markdown"]},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code == 200:
                return {"success": True, "message": "Firecrawl API key is valid"}
            elif response.status_code == 401:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"Firecrawl API error: {response.status_code}"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestOpenRouterRequest(BaseModel):
    """Request to test OpenRouter API key."""
    api_key: Optional[str] = None


class TestProviderRequest(BaseModel):
    """Request to test a specific provider's API key."""
    provider_id: str
    api_key: str


@app.post("/api/settings/test-provider")
async def test_provider_api(request: TestProviderRequest):
    """Test an API key for a specific provider."""
    from .council import PROVIDERS
    from .settings import get_settings
    
    if request.provider_id not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid provider ID")
        
    api_key = request.api_key
    if not api_key:
        # Try to get from settings
        settings = get_settings()
        # Map provider_id to setting key (e.g. 'openai' -> 'openai_api_key')
        setting_key = f"{request.provider_id}_api_key"
        if hasattr(settings, setting_key):
             api_key = getattr(settings, setting_key)
    
    if not api_key:
         return {"success": False, "message": "No API key provided or configured"}

    provider = PROVIDERS[request.provider_id]
    return await provider.validate_key(api_key)


class TestOllamaRequest(BaseModel):
    """Request to test Ollama connection."""
    base_url: str


@app.get("/api/ollama/tags")
async def get_ollama_tags(base_url: Optional[str] = None):
    """Fetch available models from Ollama."""
    import httpx
    from .config import get_ollama_base_url
    
    if not base_url:
        base_url = get_ollama_base_url()
        
    if base_url.endswith('/'):
        base_url = base_url[:-1]
        
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url}/api/tags")
            
            if response.status_code != 200:
                return {"models": [], "error": f"Ollama API error: {response.status_code}"}
                
            data = response.json()
            models = []
            for model in data.get("models", []):
                models.append({
                    "id": model.get("name"),
                    "name": model.get("name"),
                    # Ollama doesn't return context length in tags
                    "context_length": None,
                    "is_free": True,
                    "modified_at": model.get("modified_at")
                })
                
            # Sort by modified_at (newest first), fallback to name
            models.sort(key=lambda x: x.get("modified_at", ""), reverse=True)
            return {"models": models}
            
    except httpx.ConnectError:
        return {"models": [], "error": "Could not connect to Ollama. Is it running?"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/api/settings/test-ollama")
async def test_ollama_connection(request: TestOllamaRequest):
    """Test connection to Ollama instance."""
    import httpx
    
    base_url = request.base_url
    if base_url.endswith('/'):
        base_url = base_url[:-1]
        
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{base_url}/api/tags")
            
            if response.status_code == 200:
                return {"success": True, "message": "Successfully connected to Ollama"}
            else:
                return {"success": False, "message": f"Ollama API error: {response.status_code}"}
                
    except httpx.ConnectError:
        return {"success": False, "message": "Could not connect to Ollama. Is it running at this URL?"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestCustomEndpointRequest(BaseModel):
    """Request to test custom OpenAI-compatible endpoint."""
    name: str
    url: str
    api_key: Optional[str] = None


@app.post("/api/settings/test-custom-endpoint")
async def test_custom_endpoint(request: TestCustomEndpointRequest):
    """Test connection to a custom OpenAI-compatible endpoint."""
    from .providers.custom_openai import CustomOpenAIProvider

    provider = CustomOpenAIProvider()
    return await provider.validate_connection(request.url, request.api_key or "")


@app.get("/api/custom-endpoint/models")
async def get_custom_endpoint_models():
    """Fetch available models from the custom endpoint."""
    from .providers.custom_openai import CustomOpenAIProvider
    from .settings import get_settings

    settings = get_settings()
    if not settings.custom_endpoint_url:
        return {"models": [], "error": "No custom endpoint configured"}

    provider = CustomOpenAIProvider()
    models = await provider.get_models()
    return {"models": models}


@app.get("/api/models")
async def get_openrouter_models():
    """Fetch available models from OpenRouter API."""
    import httpx
    from .config import get_openrouter_api_key

    api_key = get_openrouter_api_key()
    if not api_key:
        return {"models": [], "error": "No OpenRouter API key configured"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )

            if response.status_code != 200:
                return {"models": [], "error": f"API error: {response.status_code}"}

            data = response.json()
            models = []
            
            # Comprehensive exclusion list for non-text/chat models
            excluded_terms = [
                "embed", "audio", "whisper", "tts", "dall-e", "realtime", 
                "vision-only", "voxtral", "speech", "transcribe", "sora"
            ]

            for model in data.get("data", []):
                mid = model.get("id", "").lower()
                name_lower = model.get("name", "").lower()
                
                if any(term in mid for term in excluded_terms) or any(term in name_lower for term in excluded_terms):
                    continue

                # Extract pricing - free models have 0 cost
                pricing = model.get("pricing", {})
                prompt_price = float(pricing.get("prompt", "0") or "0")
                completion_price = float(pricing.get("completion", "0") or "0")
                is_free = prompt_price == 0 and completion_price == 0

                models.append({
                    "id": f"openrouter:{model.get('id')}",
                    "name": f"{model.get('name', model.get('id'))} [OpenRouter]",
                    "provider": "OpenRouter",
                    "context_length": model.get("context_length"),
                    "is_free": is_free,
                })

            # Sort by name
            models.sort(key=lambda x: x["name"].lower())
            return {"models": models}

    except httpx.TimeoutException:
        return {"models": [], "error": "Request timed out"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/api/settings/test-openrouter")
async def test_openrouter_api(request: TestOpenRouterRequest):
    """Test OpenRouter API key with a simple request."""
    import httpx
    from .config import get_openrouter_api_key

    # Use provided key or fall back to saved key
    api_key = request.api_key if request.api_key else get_openrouter_api_key()

    if not api_key:
        return {"success": False, "message": "No API key provided or configured"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {api_key}",
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/conversations/{conversation_id}/council-config")
async def get_council_config_endpoint(conversation_id: str):
    """Get the council config snapshot for a conversation."""
    config = storage.get_council_config(conversation_id)
    if config is None:
        return {"has_config": False, "council_config": None}
    return {"has_config": True, "council_config": config}


@app.post("/api/conversations/{conversation_id}/restore-config")
async def restore_council_config(conversation_id: str):
    """Restore council config from a conversation's snapshot into global settings."""
    config = storage.get_council_config(conversation_id)
    if config is None:
        return {"restored": False, "reason": "No config snapshot found"}

    updates = {}
    if "council_models" in config:
        updates["council_models"] = config["council_models"]
    if "chairman_model" in config:
        updates["chairman_model"] = config["chairman_model"]
    if "council_temperature" in config:
        updates["council_temperature"] = config["council_temperature"]
    if "chairman_temperature" in config:
        updates["chairman_temperature"] = config["chairman_temperature"]
    if "stage2_temperature" in config:
        updates["stage2_temperature"] = config["stage2_temperature"]
    if "revision_temperature" in config:
        updates["revision_temperature"] = config["revision_temperature"]
    if "execution_mode" in config:
        updates["execution_mode"] = config["execution_mode"]
    if "stage1_prompt" in config:
        updates["stage1_prompt"] = config["stage1_prompt"]
    if "stage2_prompt" in config:
        updates["stage2_prompt"] = config["stage2_prompt"]
    if "stage5_prompt" in config:
        updates["stage5_prompt"] = config["stage5_prompt"]
    if "revision_prompt" in config:
        updates["revision_prompt"] = config["revision_prompt"]
    if "debate_turn_primary_a_prompt" in config:
        updates["debate_turn_primary_a_prompt"] = config["debate_turn_primary_a_prompt"]
    if "debate_turn_rebuttal_prompt" in config:
        updates["debate_turn_rebuttal_prompt"] = config["debate_turn_rebuttal_prompt"]
    if "debate_verdict_prompt" in config:
        updates["debate_verdict_prompt"] = config["debate_verdict_prompt"]

    # Character Names and Member Prompts
    if "character_names" in config:
        updates["character_names"] = config["character_names"]
    if "member_prompts" in config:
        updates["member_prompts"] = config["member_prompts"]

    # Chairman Character Name and Custom Prompt
    if "chairman_character_name" in config:
        updates["chairman_character_name"] = config["chairman_character_name"]
    if "chairman_custom_prompt" in config:
        updates["chairman_custom_prompt"] = config["chairman_custom_prompt"]

    if updates:
        update_settings(**updates)

    return {"restored": True, "council_config": config}


# === Preset Endpoints ===

@app.get("/api/presets")
async def list_presets():
    """List all presets with full config."""
    presets = get_presets()
    return [
        {"name": name, "config": cfg}
        for name, cfg in presets.items()
    ]


@app.post("/api/presets")
async def create_preset(request: CreatePresetRequest):
    """Create a new preset."""
    try:
        create_preset_storage(request.name, request.config)
        return {"name": request.name, "config": request.config}
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.put("/api/presets/{preset_name}")
async def update_preset_endpoint(preset_name: str, request: CreatePresetRequest):
    """Update an existing preset."""
    result = update_preset_storage(preset_name, request.config)
    if result is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"name": preset_name, "config": request.config}


@app.delete("/api/presets/{preset_name}")
async def delete_preset_endpoint(preset_name: str):
    """Delete a preset."""
    deleted = delete_preset_storage(preset_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"status": "deleted", "name": preset_name}


@app.post("/api/presets/batch-export")
async def batch_export_presets(request: BatchExportRequest):
    """Export multiple presets as a JSON array."""
    from .presets import export_presets
    return export_presets(request.preset_names)


@app.post("/api/presets/batch-import")
async def batch_import_presets(request: BatchImportRequest):
    """Import multiple presets with conflict resolution."""
    from .presets import import_presets
    if request.conflict_mode not in ["skip", "overwrite", "rename"]:
        raise HTTPException(
            status_code=400,
            detail="conflict_mode must be 'skip', 'overwrite', or 'rename'"
        )
    return import_presets(request.presets, request.conflict_mode)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
