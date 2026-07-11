/**
 * Canonical job-type identifiers. Defined in core so enqueuers (web, cli) and
 * the worker's handler registry share one vocabulary.
 */
export const JOB_TYPES = {
  intakeExtractProfile: 'intake.extract_profile',
  offerForge: 'offer.forge',
  marketSelect: 'market.select',
  marketProfile: 'market.profile',
  vocMine: 'voc.mine',
  genomeDecompose: 'genome.decompose',
  genomeHarvest: 'genome.harvest',
  assetRegenBlock: 'asset.regen_block',
  assetGenerate: 'asset.generate',
  assetCouncil: 'asset.council',
  buildStep: 'build.step',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
