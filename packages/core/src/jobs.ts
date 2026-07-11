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
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
