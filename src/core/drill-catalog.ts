export interface DrillPrescription {
  issueId: string
  movement: string
  desiredChange: string
  drill: string
  relationship: string
}

export const DRILL_CATALOG: Record<string, DrillPrescription> = {
  'tempo-outlier-fast': {
    issueId: 'tempo-outlier', movement: 'Backswing-to-downswing cadence', desiredChange: 'Allow the backswing to complete before acceleration begins.',
    drill: 'Count “one-two-three” to the top and “one” to impact for 10 half-speed swings, then blend into full speed without changing the cadence.',
    relationship: 'The count lengthens the measured backswing interval relative to the downswing without prescribing a club-path change.',
  },
  'tempo-outlier-slow': {
    issueId: 'tempo-outlier', movement: 'Backswing-to-downswing cadence', desiredChange: 'Keep the backswing moving through the top without an extended pause.',
    drill: 'Make 10 continuous-motion half-swings while counting evenly to the top and through impact; stop if a pause reappears.',
    relationship: 'Continuous rehearsal directly targets the extended measured transition interval.',
  },
  'pelvis-depth': {
    issueId: 'pelvis-depth', movement: 'Projected pelvis depth from address to impact', desiredChange: 'Retain space behind the pelvis while rotating through impact.',
    drill: 'Chair drill: address with your glutes lightly touching a chair. Rehearse slow backswings and downswings while keeping one hip in contact through impact.',
    relationship: 'Chair contact gives external feedback for the exact pelvis-depth movement screened by the rule.',
  },
  'head-movement': {
    issueId: 'head-movement', movement: '2D head translation', desiredChange: 'Reduce translation while still allowing the head to rotate naturally.',
    drill: 'Shadow-line drill: place a vertical reference just outside your head in the video. Make waist-high swings while keeping translation inside that line, without freezing your neck.',
    relationship: 'The visual boundary constrains translation, which is the measured variable, without claiming rotation should stop.',
  },
  'finish-balance': {
    issueId: 'finish-balance', movement: 'Finish pose relative to the visible stance', desiredChange: 'Finish centered enough to hold the pose without an extra recovery step.',
    drill: 'Hold-the-finish drill: hit 10 smooth half-swings and freeze for a full three-count. Step down in speed until every finish is stable.',
    relationship: 'The hold exposes whether the finish pose can be maintained; it does not claim to measure foot pressure.',
  },
  'sequence-order': {
    issueId: 'sequence-order', movement: 'Pelvis-to-shoulder peak-speed order in transition', desiredChange: 'Let pelvis motion begin before the chest reaches peak speed.',
    drill: 'Step drill: begin with the feet together, step toward the target as the backswing completes, then swing through at 50% speed.',
    relationship: 'The step supplies a transition cue intended to start lower-body motion before upper-body acceleration.',
  },
}

export function drillFor(key: keyof typeof DRILL_CATALOG): DrillPrescription {
  return DRILL_CATALOG[key]
}
