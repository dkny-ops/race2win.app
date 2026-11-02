create table private.winner_contact_closures (winner_id uuid not null,
closed_by uuid not null,
closed_at timestamp with time zone default now() not null,
reason text default 'owner_reported_paid'::text not null);
create table private.winner_owner_verifications (winner_id uuid not null,
email_checked_at timestamp with time zone,
email_checked_by uuid,
paid_checked_at timestamp with time zone,
paid_checked_by uuid);
alter table private.winner_contact_closures add constraint winner_contact_closures_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES provisional_winners(id);
alter table private.winner_owner_verifications add constraint winner_owner_verifications_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES provisional_winners(id);
alter table private.winner_contact_closures add constraint winner_contact_closures_pkey PRIMARY KEY (winner_id);
alter table private.winner_owner_verifications add constraint winner_owner_verifications_pkey PRIMARY KEY (winner_id);
