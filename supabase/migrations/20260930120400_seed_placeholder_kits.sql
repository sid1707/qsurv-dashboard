-- Placeholder kits so projects can be created before real panels are configured.
-- Targets, wells, channels and Ct limits are dummy values: replace them with the
-- real panel definitions before any production use.

insert into public.kits (name, version, active)
values
  ('Huwel Multipathogen', '0.1-placeholder', true),
  ('Huwel Environmental Surveillance', '0.1-placeholder', true)
on conflict (name, version) do nothing;

insert into public.kit_targets (
  kit_id, target_name, aliases, fluorophore, channel, plate_wells, control_type, ct_min, ct_max, sort_order
)
select k.id, t.target_name, t.aliases, t.fluorophore, t.channel, t.plate_wells,
       t.control_type::public.kit_control_type, t.ct_min, t.ct_max, t.sort_order
from public.kits k
join (
  values
    ('Huwel Multipathogen', 'Target A', array['TGT-A'], 'FAM', 'Green', array['A1', 'B1', 'C1'], 'none', 12, 38, 1),
    ('Huwel Multipathogen', 'Target B', array['TGT-B'], 'HEX', 'Yellow', array['A1', 'B1', 'C1'], 'none', 12, 38, 2),
    ('Huwel Multipathogen', 'Internal Control', array['IC'], 'Cy5', 'Red', array['A1', 'B1', 'C1'], 'internal_control', 18, 32, 3),
    ('Huwel Environmental Surveillance', 'Target X', array['TGT-X'], 'FAM', 'Green', array['A1', 'B1', 'C1'], 'none', 12, 38, 1),
    ('Huwel Environmental Surveillance', 'Target Y', array['TGT-Y'], 'ROX', 'Orange', array['A1', 'B1', 'C1'], 'none', 12, 38, 2),
    ('Huwel Environmental Surveillance', 'Internal Control', array['IC'], 'Cy5', 'Red', array['A1', 'B1', 'C1'], 'internal_control', 18, 32, 3)
) as t(kit_name, target_name, aliases, fluorophore, channel, plate_wells, control_type, ct_min, ct_max, sort_order)
  on t.kit_name = k.name
where k.version = '0.1-placeholder'
on conflict (kit_id, target_name) do nothing;
