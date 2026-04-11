import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';
import { withMeta } from '../../types.js';
import { fetchAllStudyMolecularProfiles } from '../../databases/cbioportal.js';

function clampLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

cli({
  site: 'cbioportal',
  name: 'profiles',
  description: 'List molecular profiles for a cBioPortal study',
  database: 'cbioportal',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'study', positional: true, required: true, help: 'cBioPortal study ID (e.g. acc_tcga_pan_can_atlas_2018)', producedBy: ['cbioportal/studies'] },
    { name: 'type', help: 'Optional filter on molecularAlterationType or datatype (e.g. MUTATION_EXTENDED, MRNA_EXPRESSION)' },
    { name: 'limit', type: 'int', default: 50, help: 'Max profiles to return (1-100)' },
  ],
  examples: [
    {
      goal: 'Inspect all molecular profiles for a study before querying mutations',
      command: 'biocli cbioportal profiles luad_tcga_pan_can_atlas_2018 -f json',
    },
    {
      goal: 'Only list mutation-related profiles for a chosen cohort',
      command: 'biocli cbioportal profiles luad_tcga_pan_can_atlas_2018 --type MUTATION_EXTENDED -f json',
    },
  ],
  columns: ['molecularProfileId', 'molecularAlterationType', 'datatype', 'studyId'],
  func: async (ctx, args) => {
    const studyId = String(args.study ?? '').trim();
    if (!studyId) throw new ArgumentError('Study ID is required', 'Example: biocli cbioportal profiles acc_tcga_pan_can_atlas_2018');

    const typeFilter = String(args.type ?? '').trim().toUpperCase();
    const limit = clampLimit(args.limit, 50);

    const profiles = await fetchAllStudyMolecularProfiles(ctx, studyId, 100);
    const filtered = typeFilter
      ? profiles.filter(profile =>
        String(profile.molecularAlterationType ?? '').toUpperCase() === typeFilter
        || String(profile.molecularAlterationType ?? '').toUpperCase().includes(typeFilter)
        || String(profile.datatype ?? '').toUpperCase() === typeFilter
        || String(profile.datatype ?? '').toUpperCase().includes(typeFilter))
      : profiles;

    if (filtered.length === 0) {
      throw new EmptyResultError('cbioportal/profiles', typeFilter
        ? `No molecular profiles of type "${typeFilter}" were found in study "${studyId}".`
        : `Study "${studyId}" has no molecular profiles in cBioPortal.`);
    }

    const rows = filtered.slice(0, limit).map(profile => ({
      molecularProfileId: profile.molecularProfileId,
      molecularAlterationType: profile.molecularAlterationType ?? '',
      datatype: profile.datatype ?? '',
      studyId: profile.studyId ?? studyId,
      name: profile.name ?? '',
    }));

    return withMeta(rows, {
      totalCount: filtered.length,
      query: studyId,
    });
  },
});
