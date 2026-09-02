-- Hosts must be able to read every rider in their room even if Realtime
-- evaluates RLS without the SECURITY DEFINER membership helper.

drop policy if exists room_players_select_member on public.room_players;
create policy room_players_select_member on public.room_players
  for select
  using (
    user_id = auth.uid()
    or public.is_room_member(room_code)
    or exists (
      select 1
      from public.rooms
      where rooms.code = room_code
        and rooms.host_id = auth.uid()
    )
  );

grant select, insert, update on public.rooms to authenticated;
grant select, insert, update on public.room_players to authenticated;
