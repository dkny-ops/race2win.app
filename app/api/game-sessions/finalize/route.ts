@@
     const finalizedSession = finalizedRows?.[0] ?? null;
-    if (finalizedSession) return NextResponse.json(officialOutcome(finalizedSession), { headers: CACHE });
+    if (finalizedSession) {
+      // Ensure competition week is refreshed for this finalized session.
+      // This is a targeted, idempotent, service-role-only helper that triggers
+      // the existing private.refresh_competition_week logic. It is safe to
+      // call here because the RPC acquires the same advisory lock used by the
+      // trigger-based materialization and is idempotent.
+      try {
+        // Fire-and-forget but await to observe errors; do not fail the finalize
+        // response if the refresh fails — the validated run is authoritative.
+        await admin.rpc("rtw_post_finalize_refresh_week", { p_session_id: session.id });
+      } catch (err) {
+        // Log the failure for operational visibility and continue returning
+        // the official outcome. The validated_runs row is authoritative.
+        logSecurityEvent({ eventType: "game_session.finalize.refresh_failed", route: "/api/game-sessions/finalize", requestId, reason: "refresh_failed", status: 202, message: String(err) });
+      }
+      return NextResponse.json(officialOutcome(finalizedSession), { headers: CACHE });
+    }
*** End Patch
