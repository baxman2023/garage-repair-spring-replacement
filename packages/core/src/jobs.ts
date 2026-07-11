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
  assetFocusGroup: 'asset.focus_group',
  assetFocusFix: 'asset.focus_fix',
  assetDeslop: 'asset.deslop',
  assetCompliance: 'asset.compliance',
  assetPackage: 'asset.package',
  quizGenerate: 'quiz.generate',
  webhookDeliver: 'webhook.deliver',
  challengerGenerate: 'challenger.generate',
  predictionsResolve: 'predictions.resolve',
  calibrationRun: 'calibration.run',
  buildStep: 'build.step',
  autopsyRun: 'autopsy.run',
  learningNightly: 'learning.nightly',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/**
 * Job types that spend model tokens — the `worker_generation_enabled` master
 * kill switch (WO-052) pauses exactly these.
 */
export const GENERATION_JOB_TYPES: readonly JobType[] = [
  JOB_TYPES.intakeExtractProfile,
  JOB_TYPES.offerForge,
  JOB_TYPES.marketSelect,
  JOB_TYPES.marketProfile,
  JOB_TYPES.vocMine,
  JOB_TYPES.genomeDecompose,
  JOB_TYPES.genomeHarvest,
  JOB_TYPES.assetRegenBlock,
  JOB_TYPES.assetGenerate,
  JOB_TYPES.assetCouncil,
  JOB_TYPES.assetFocusGroup,
  JOB_TYPES.assetFocusFix,
  JOB_TYPES.assetDeslop,
  JOB_TYPES.quizGenerate,
  JOB_TYPES.challengerGenerate,
  JOB_TYPES.buildStep,
  JOB_TYPES.autopsyRun,
  JOB_TYPES.learningNightly,
];
