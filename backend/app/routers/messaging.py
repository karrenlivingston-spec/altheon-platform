"""Clinic staff messaging (clinic-wide and direct messages)."""

from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import supabase
from app.dependencies.permissions import ALL_ROLES, require_role
from app.routers.tasks import _staff_display_name, load_clinic_staff_list, load_staff_profiles
from routers.fee_schedule import (
    _assert_user_has_clinic_access,
    _resolve_bearer_user_id,
)

router = APIRouter(dependencies=[Depends(require_role(*ALL_ROLES))])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _handle_supabase_error(response: Any, *, table: str = "unknown") -> None:
    error = getattr(response, "error", None)
    if error:
        detail = getattr(error, "message", None) or str(error)
        print(f"[messaging] Supabase error table={table} detail={detail}")
        raise HTTPException(status_code=500, detail=detail)


class MessageCreate(BaseModel):
    sender_id: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)


class DMCreate(BaseModel):
    participant_user_ids: list[str] = Field(..., min_length=2, max_length=2)


def _shape_message(row: dict[str, Any], profiles: dict[str, dict[str, Any]]) -> dict[str, Any]:
    sender_id = str(row.get("sender_id") or "").strip()
    profile = profiles.get(sender_id)
    return {
        "id": row.get("id"),
        "conversation_id": row.get("conversation_id"),
        "sender_id": sender_id,
        "sender_name": _staff_display_name(profile),
        "sender_first_name": (profile or {}).get("first_name"),
        "sender_last_name": (profile or {}).get("last_name"),
        "content": row.get("content"),
        "created_at": row.get("created_at"),
    }


def _ensure_clinic_wide_conversation(clinic_id: str) -> dict[str, Any]:
    cid = clinic_id.strip()
    try:
        existing = (
            supabase.table("conversations")
            .select("id, clinic_id, type, created_at")
            .eq("clinic_id", cid)
            .eq("type", "clinic_wide")
            .limit(1)
            .execute()
        )
        _handle_supabase_error(existing, table="conversations")
        rows = existing.data or []
        if rows:
            return rows[0]

        created = (
            supabase.table("conversations")
            .insert({"clinic_id": cid, "type": "clinic_wide"})
            .execute()
        )
        _handle_supabase_error(created, table="conversations")
        conv_rows = created.data or []
        if not conv_rows:
            raise HTTPException(status_code=500, detail="Failed to create clinic-wide conversation")
        conv = conv_rows[0]
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    conv_id = str(conv.get("id") or "").strip()
    profiles = load_staff_profiles(cid)
    participant_rows = [
        {"conversation_id": conv_id, "user_id": uid}
        for uid in profiles.keys()
    ]
    if participant_rows:
        try:
            ins = supabase.table("conversation_participants").insert(participant_rows).execute()
            _handle_supabase_error(ins, table="conversation_participants")
        except Exception:
            traceback.print_exc()
    return conv


def _sync_clinic_wide_participants(clinic_id: str, conversation_id: str) -> None:
    profiles = load_staff_profiles(clinic_id)
    if not profiles:
        return
    try:
        existing = (
            supabase.table("conversation_participants")
            .select("user_id")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        _handle_supabase_error(existing, table="conversation_participants")
        have = {str(r.get("user_id") or "") for r in (existing.data or []) if isinstance(r, dict)}
        missing = [uid for uid in profiles.keys() if uid not in have]
        if missing:
            ins = (
                supabase.table("conversation_participants")
                .insert([{"conversation_id": conversation_id, "user_id": uid} for uid in missing])
                .execute()
            )
            _handle_supabase_error(ins, table="conversation_participants")
    except Exception:
        traceback.print_exc()


def _find_existing_dm(clinic_id: str, user_a: str, user_b: str) -> Optional[dict[str, Any]]:
    pair = sorted([user_a.strip(), user_b.strip()])
    try:
        conv_resp = (
            supabase.table("conversations")
            .select("id, clinic_id, type, created_at")
            .eq("clinic_id", clinic_id.strip())
            .eq("type", "direct")
            .execute()
        )
        _handle_supabase_error(conv_resp, table="conversations")
        conv_ids = [str(c.get("id") or "") for c in (conv_resp.data or []) if c.get("id")]
        if not conv_ids:
            return None

        parts_resp = (
            supabase.table("conversation_participants")
            .select("conversation_id, user_id")
            .in_("conversation_id", conv_ids)
            .in_("user_id", pair)
            .execute()
        )
        _handle_supabase_error(parts_resp, table="conversation_participants")
        by_conv: dict[str, set[str]] = {}
        for row in parts_resp.data or []:
            if not isinstance(row, dict):
                continue
            conv_id = str(row.get("conversation_id") or "")
            uid = str(row.get("user_id") or "")
            if conv_id and uid:
                by_conv.setdefault(conv_id, set()).add(uid)
        for conv_id, users in by_conv.items():
            if users == set(pair):
                for conv in conv_resp.data or []:
                    if str(conv.get("id") or "") == conv_id:
                        return conv
    except Exception:
        traceback.print_exc()
    return None


def _participant_last_read(conversation_id: str, user_id: str) -> Optional[str]:
    try:
        resp = (
            supabase.table("conversation_participants")
            .select("last_read_at")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp, table="conversation_participants")
        rows = resp.data or []
        if rows:
            return rows[0].get("last_read_at")
    except Exception:
        traceback.print_exc()
    return None


def _unread_count(conversation_id: str, user_id: str, last_read_at: Optional[str]) -> int:
    try:
        q = (
            supabase.table("messages")
            .select("id", count="exact")
            .eq("conversation_id", conversation_id)
            .neq("sender_id", user_id)
        )
        if last_read_at:
            q = q.gt("created_at", last_read_at)
        resp = q.execute()
        _handle_supabase_error(resp, table="messages")
        count = getattr(resp, "count", None)
        if count is not None:
            return int(count)
        return len(resp.data or [])
    except Exception:
        traceback.print_exc()
        return 0


def _last_message(conversation_id: str, profiles: dict[str, dict[str, Any]]) -> Optional[dict[str, Any]]:
    try:
        resp = (
            supabase.table("messages")
            .select("id, sender_id, content, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp, table="messages")
        rows = resp.data or []
        if not rows:
            return None
        row = rows[0]
        sender_id = str(row.get("sender_id") or "").strip()
        profile = profiles.get(sender_id)
        return {
            "content": row.get("content"),
            "sender_id": sender_id,
            "sender_name": _staff_display_name(profile),
            "created_at": row.get("created_at"),
        }
    except Exception:
        traceback.print_exc()
        return None


def _conversation_participants(
    conversation_id: str,
    profiles: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    try:
        resp = (
            supabase.table("conversation_participants")
            .select("user_id")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        _handle_supabase_error(resp, table="conversation_participants")
        out: list[dict[str, Any]] = []
        for row in resp.data or []:
            if not isinstance(row, dict):
                continue
            uid = str(row.get("user_id") or "").strip()
            if not uid:
                continue
            profile = profiles.get(uid) or {}
            out.append(
                {
                    "user_id": uid,
                    "first_name": profile.get("first_name"),
                    "last_name": profile.get("last_name"),
                }
            )
        return out
    except Exception:
        traceback.print_exc()
        return []


def _shape_conversation(
    conv: dict[str, Any],
    user_id: str,
    profiles: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    conv_id = str(conv.get("id") or "").strip()
    last_read = _participant_last_read(conv_id, user_id)
    shaped: dict[str, Any] = {
        "id": conv_id,
        "clinic_id": conv.get("clinic_id"),
        "type": conv.get("type"),
        "created_at": conv.get("created_at"),
        "last_message": _last_message(conv_id, profiles),
        "unread_count": _unread_count(conv_id, user_id, last_read),
    }
    if conv.get("type") == "direct":
        shaped["participants"] = _conversation_participants(conv_id, profiles)
    return shaped


def _ensure_participant(conversation_id: str, user_id: str) -> None:
    try:
        resp = (
            supabase.table("conversation_participants")
            .select("id")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(resp, table="conversation_participants")
        if resp.data:
            return
        ins = (
            supabase.table("conversation_participants")
            .insert({"conversation_id": conversation_id, "user_id": user_id})
            .execute()
        )
        _handle_supabase_error(ins, table="conversation_participants")
    except Exception:
        traceback.print_exc()


def _mark_conversation_read(conversation_id: str, user_id: str, read_at: Optional[str] = None) -> None:
    stamp = read_at or _now_iso()
    try:
        resp = (
            supabase.table("conversation_participants")
            .update({"last_read_at": stamp})
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        _handle_supabase_error(resp, table="conversation_participants")
        if resp.data:
            return
        _ensure_participant(conversation_id, user_id)
        supabase.table("conversation_participants").update({"last_read_at": stamp}).eq(
            "conversation_id", conversation_id
        ).eq("user_id", user_id).execute()
    except Exception:
        traceback.print_exc()


@router.get("/{clinic_id}/staff")
def list_clinic_staff(
    clinic_id: str,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    try:
        staff = load_clinic_staff_list(cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    out = [
        {
            "user_id": member["user_id"],
            "first_name": member.get("first_name"),
            "last_name": member.get("last_name"),
            "role": member.get("role"),
        }
        for member in staff
    ]
    out.sort(key=lambda r: (_staff_display_name(r), str(r.get("user_id") or "")))
    return out


@router.get("/{clinic_id}/conversations")
def list_conversations(
    clinic_id: str,
    user_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    uid = user_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    profiles = load_staff_profiles(cid)
    out: list[dict[str, Any]] = []
    clinic_wide_id = ""

    try:
        clinic_wide = _ensure_clinic_wide_conversation(cid)
        clinic_wide_id = str(clinic_wide.get("id") or "")
        _sync_clinic_wide_participants(cid, clinic_wide_id)
        _ensure_participant(clinic_wide_id, uid)
        out.append(_shape_conversation(clinic_wide, uid, profiles))
    except Exception:
        traceback.print_exc()

    try:
        part_resp = (
            supabase.table("conversation_participants")
            .select("conversation_id")
            .eq("user_id", uid)
            .execute()
        )
        _handle_supabase_error(part_resp, table="conversation_participants")
        conv_ids = list(
            {
                str(r.get("conversation_id") or "")
                for r in (part_resp.data or [])
                if isinstance(r, dict) and r.get("conversation_id")
            }
        )
        if conv_ids:
            conv_resp = (
                supabase.table("conversations")
                .select("id, clinic_id, type, created_at")
                .eq("clinic_id", cid)
                .eq("type", "direct")
                .in_("id", conv_ids)
                .execute()
            )
            _handle_supabase_error(conv_resp, table="conversations")
            for conv in conv_resp.data or []:
                if not isinstance(conv, dict):
                    continue
                if str(conv.get("id") or "") == clinic_wide_id:
                    continue
                out.append(_shape_conversation(conv, uid, profiles))
    except Exception:
        traceback.print_exc()

    clinic_wide_items = [c for c in out if c.get("type") == "clinic_wide"]
    direct_items = sorted(
        [c for c in out if c.get("type") == "direct"],
        key=lambda c: (c.get("last_message") or {}).get("created_at") or c.get("created_at") or "",
        reverse=True,
    )
    return clinic_wide_items + direct_items


@router.post("/{clinic_id}/conversations/dm")
def create_dm_conversation(
    clinic_id: str,
    body: DMCreate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    if len(body.participant_user_ids) != 2:
        raise HTTPException(status_code=400, detail="participant_user_ids must contain exactly 2 user IDs")
    user_a = body.participant_user_ids[0].strip()
    user_b = body.participant_user_ids[1].strip()
    if not user_a or not user_b or user_a == user_b:
        raise HTTPException(status_code=400, detail="participant_user_ids must be two distinct user IDs")

    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    existing = _find_existing_dm(cid, user_a, user_b)
    if existing:
        profiles = load_staff_profiles(cid)
        return _shape_conversation(existing, caller, profiles)

    try:
        created = (
            supabase.table("conversations")
            .insert({"clinic_id": cid, "type": "direct"})
            .execute()
        )
        _handle_supabase_error(created, table="conversations")
        rows = created.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create conversation")
        conv = rows[0]
        conv_id = str(conv.get("id") or "").strip()
        ins = (
            supabase.table("conversation_participants")
            .insert(
                [
                    {"conversation_id": conv_id, "user_id": user_a},
                    {"conversation_id": conv_id, "user_id": user_b},
                ]
            )
            .execute()
        )
        _handle_supabase_error(ins, table="conversation_participants")
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    profiles = load_staff_profiles(cid)
    return _shape_conversation(conv, caller, profiles)


@router.get("/{clinic_id}/conversations/{conversation_id}/messages")
def list_messages(
    clinic_id: str,
    conversation_id: str,
    user_id: str = Query(..., min_length=1),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    conv_id = conversation_id.strip()
    uid = user_id.strip()
    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    try:
        conv_resp = (
            supabase.table("conversations")
            .select("id, clinic_id, type")
            .eq("id", conv_id)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(conv_resp, table="conversations")
        if not (conv_resp.data or []):
            raise HTTPException(status_code=404, detail="Conversation not found")
        conv = conv_resp.data[0]
        if conv.get("type") == "direct":
            part = (
                supabase.table("conversation_participants")
                .select("id")
                .eq("conversation_id", conv_id)
                .eq("user_id", uid)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(part, table="conversation_participants")
            if not (part.data or []):
                raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        return []

    try:
        resp = (
            supabase.table("messages")
            .select("id, conversation_id, sender_id, content, created_at")
            .eq("conversation_id", conv_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        _handle_supabase_error(resp, table="messages")
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]
        rows.reverse()
    except Exception:
        traceback.print_exc()
        return []

    profiles = load_staff_profiles(cid)
    shaped = [_shape_message(r, profiles) for r in rows]
    if rows:
        latest_at = str(rows[-1].get("created_at") or _now_iso())
        _mark_conversation_read(conv_id, uid, latest_at)
    return shaped


@router.post("/{clinic_id}/conversations/{conversation_id}/messages")
def create_message(
    clinic_id: str,
    conversation_id: str,
    body: MessageCreate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    cid = clinic_id.strip()
    conv_id = conversation_id.strip()
    sender_id = body.sender_id.strip()
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    try:
        caller = _resolve_bearer_user_id(authorization)
        _assert_user_has_clinic_access(caller, cid)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if sender_id != caller:
        raise HTTPException(status_code=403, detail="sender_id must match authenticated user")

    try:
        conv_resp = (
            supabase.table("conversations")
            .select("id, clinic_id, type")
            .eq("id", conv_id)
            .eq("clinic_id", cid)
            .limit(1)
            .execute()
        )
        _handle_supabase_error(conv_resp, table="conversations")
        if not (conv_resp.data or []):
            raise HTTPException(status_code=404, detail="Conversation not found")
        conv = conv_resp.data[0]
        if conv.get("type") == "direct":
            part = (
                supabase.table("conversation_participants")
                .select("id")
                .eq("conversation_id", conv_id)
                .eq("user_id", sender_id)
                .limit(1)
                .execute()
            )
            _handle_supabase_error(part, table="conversation_participants")
            if not (part.data or []):
                raise HTTPException(status_code=403, detail="Not a participant in this conversation")
        else:
            _ensure_participant(conv_id, sender_id)

        ins = (
            supabase.table("messages")
            .insert(
                {
                    "conversation_id": conv_id,
                    "sender_id": sender_id,
                    "content": content,
                }
            )
            .execute()
        )
        _handle_supabase_error(ins, table="messages")
        rows = ins.data or []
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to create message")
        row = rows[0]
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    profiles = load_staff_profiles(cid)
    return _shape_message(row, profiles)
