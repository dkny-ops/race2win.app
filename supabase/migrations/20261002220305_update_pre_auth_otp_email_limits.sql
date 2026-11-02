-- UI countdowns are only convenience. The database remains the authoritative
-- enforcement point for every OTP request and verification attempt.
update private.pre_auth_otp_rate_limit_policies
set request_limit = case
  when action = 'otp_request' and scope = 'email' then 1
  when action = 'otp_verify' and scope = 'email' then 3
  else request_limit
end
where (action, scope) in (('otp_request', 'email'), ('otp_verify', 'email'));
