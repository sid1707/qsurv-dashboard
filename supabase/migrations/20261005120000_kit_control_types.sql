-- Validation and compilation rules treat the two internal controls differently:
-- the exogenous control (spiked in, e.g. MS-2 phage) checks extraction and PCR,
-- the endogenous control (from the sample, e.g. Enterobacter spp., PMMoV) is used
-- for normalisation. New enum values cannot be used in the transaction that adds
-- them, so they live in their own migration.

alter type public.kit_control_type add value if not exists 'exogenous_control';
alter type public.kit_control_type add value if not exists 'endogenous_control';
