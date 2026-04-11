import { cli, Strategy } from '../../registry.js';
import { EmptyResultError } from '../../errors.js';
import { withMeta } from '../../types.js';
import { buildCbioPortalUrl, type CbioPortalStudy } from '../../databases/cbioportal.js';

function clampLimit(value: unknown, fallback = 10): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

cli({
  site: 'cbioportal',
  name: 'studies',
  description: 'Search cancer studies in cBioPortal',
  database: 'cbioportal',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'keyword', positional: true, help: 'Keyword for study name, disease, or cohort (optional)' },
    { name: 'limit', type: 'int', default: 10, help: 'Max studies to return (1-100)' },
  ],
  columns: ['studyId', 'name', 'cancerType', 'sequencedSampleCount', 'cnaSampleCount'],
  func: async (ctx, args) => {
    const keyword = String(args.keyword ?? '').trim();
    const limit = clampLimit(args.limit, 10);

    const studies = await ctx.fetchJson(buildCbioPortalUrl('/studies', {
      keyword: keyword || undefined,
      projection: 'SUMMARY',
      pageSize: String(limit),
      pageNumber: '0',
    })) as CbioPortalStudy[];

    if (!Array.isArray(studies) || studies.length === 0) {
      throw new EmptyResultError('cbioportal/studies', keyword
        ? `No cBioPortal studies matched "${keyword}". Try a broader disease or cohort keyword.`
        : 'No cBioPortal studies were returned.');
    }

    const rows = studies.map(study => ({
      studyId: study.studyId,
      name: study.name ?? '',
      cancerType: study.cancerType?.name ?? study.cancerTypeId ?? '',
      sequencedSampleCount: study.sequencedSampleCount ?? '',
      cnaSampleCount: study.cnaSampleCount ?? '',
      publicStudy: Boolean(study.publicStudy),
    }));

    return withMeta(rows, {
      totalCount: rows.length,
      query: keyword || 'all studies',
    });
  },
});
