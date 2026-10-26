-- Defense-in-depth: these server-owned private tables already have no browser grants.
-- Enable RLS without adding policies or public privileges. SECURITY DEFINER
-- routines remain the supported access path; the existing service-role
-- capability on winner_contact_closures is preserved for server code.
alter table private.winner_contact_closures enable row level security;
alter table private.winner_owner_verifications enable row level security;
alter table private.rtw_human_checks enable row level security;
alter table private.rtw_human_check_history enable row level security;

revoke all on table private.winner_contact_closures,
  private.winner_owner_verifications,
  private.rtw_human_checks,
  private.rtw_human_check_history
from public, anon, authenticated;

grant select, insert on table private.winner_contact_closures to service_role;
