## ROOT CAUSE FOUND

**root_cause_summary:**
The scheduler did not duplicate tasks. The active config enabled both `vertical` and `avatar` in `autoPilotPipelineModes`, and the scheduler treats those modes as additive. With 3 mapped accounts per mode, it created 3 direct XAI batch vertical jobs plus 3 avatar-derived jobs: 6 total.

**evidence_summary:**
Created on 2026-05-09 morning Asia/Shanghai:

- `1778281899256_8a653b4a` - vertical, sourceRank 8, Web3plus, scheduled 18:08
- `1778282005075_7ba7a61d` - vertical, sourceRank 9, RWAplus, scheduled 18:20
- `1778282533796_b6e2657d` - vertical, sourceRank 7, Web4plus, scheduled 18:15
- `1778284267142_499b84fa` - avatar, sourceRank 1, Web4plus, scheduled 07:33 catch-up
- `1778286187632_ecadd5f4` - avatar, sourceRank 2, Web3plus, scheduled 08:30
- `1778288710227_317b429f` - avatar, sourceRank 3, RWAplus, scheduled 08:00 catch-up

The “extra” batch products were the enabled `vertical` mode outputs using configured source ranks 7/8/9.

**specialist_hint:**
Scheduler/config UI ownership: AutoPilot mode selection and planned task count summary.

**fix_direction:**
For only 3 morning digital-human tasks, remove `vertical` from `global.autoPilotPipelineModes`, or make the UI/scheduler treat avatar as exclusive for this automation profile. Also surface planned total as sum of active mode slots.

**files_changed:**
`.planning/debug/scheduled-publish-extra-tasks.md` only.
