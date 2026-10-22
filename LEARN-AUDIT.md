# Learn audit, October 2026

Every written lesson, judged on how well it makes you learn: do you have to recall, are there worked
examples that fade into your own problems, are topics mixed, does a wrong answer help, can a question be
gamed. Worked out from the lesson files (the script's numbers), then read through by hand.

## What would make the biggest difference, in order

1. **Questions inside the imported lessons.** 131 of the 200 lessons are a book's words. In most of them you
   read 8 to 40 cards before the first question, and there are 3 or 4 questions in all (103 lessons have
   fewer than one question for every three reading cards). Reading is not learning: each section needs a
   question straight after it. *Content: Daybook questions added after each section (`added`, `after`).*
2. **A lesson could be learned by tapping Good.** 221 final-check cards are self-rated flash cards. *Fixed in
   4.0.31: where a lesson has marked check cards, only those count.*
3. **A wrong number said only the right one.** *Fixed in 4.0.31: a wrong answer now says what it most likely got
   wrong (the digits right but the units or the point out, twice or half, 60, 2π, √2, √3, the sign, rounded too
   early).* Next: a card's own likely mistake, where the generic list falls short.
4. **No mixing in two lessons out of three.** 136 lessons have no mix stage, so every question in them uses the
   rule just taught. *Fixed in 4.0.31 for every lesson: up to three questions you have met from earlier lessons
   (those it builds on first) are mixed in before the check.*
5. **Numbers that repeat.** 95 numeric questions draw fewer than six sets of numbers, and 14 have none, so after
   a few reviews you remember the answer, not the method. *Widen the ranges.*
6. **Widget questions you can game.** 21 widget questions show the readings while you answer, and some let you
   pick the settings ("set any peak you like"), so you can pick easy numbers. *Hide the readings, and start
   the controls somewhere random.*
7. **Review looked like a mountain.** *Fixed in 4.0.31: Review is a 12-minute round, the cards most at risk of
   being forgotten first; Today and Home show the minutes, not the backlog.*
8. **One source only** in 64 lessons, and 36 lessons not written. *Second sources and the missing lessons.*
9. **Few things to tinker with.** 161 lessons have no widget or machine. *New widgets and scenes where the idea
   is spatial or moving.*

Smaller: 135 numeric questions have no hint; 2 orderings have only three items (one in six by guessing).

## Lesson by lesson

Asks per read: marked questions for each reading card (1 or more is good). Longest read: the most reading
cards in a row with no question. Worked: a worked example, and a faded one after it. Mix: questions in the
mix stage. Flags: `check-flash` self-rated final check, `num-fewdraws` numbers that repeat, `num-novars` a
fixed number, `widget-num-nohide` readings showing while you answer, `mcq-allabove` a both/all/none option.

| Lesson | Book | Asks per read | Longest read | Worked | Mix | Sources | Verdict | Flags |
|---|---|---|---|---|---|---|---|---|
| maths.pure.integration | yes | 0.0 | 32 |  |  | 4 | mostly reading | check-flash ×12 |
| maths.pure.numerical-methods | yes | 0.0 | 26 |  |  | 2 | mostly reading | check-flash ×6 |
| maths.stats.data | yes | 0.0 | 21 |  |  | 3 | mostly reading | check-flash ×8 |
| maths.stats.sampling | yes | 0.0 | 20 |  |  | 1 | mostly reading | check-flash ×3 |
| maths.pure.vectors | yes | 0.0 | 18 |  |  | 1 | mostly reading | check-flash ×3 |
| maths.pure.coordinate-geometry | yes | 0.0 | 14 |  |  | 2 | mostly reading | check-flash ×6 |
| physics.waves.superposition | yes | 0.0 | 11 |  |  | 2 | mostly reading | check-flash ×6 |
| maths.stats.distributions | yes | 0.0 | 9 |  |  | 3 | mostly reading | check-flash ×9 |
| physics.fields.electric | yes | 0.0 | 8 |  |  | 2 | mostly reading | check-flash ×3 |
| maths.pure.exp-log | yes | 0.0 | 7 |  |  | 4 | mostly reading | check-flash ×12 |
| maths.stats.hypothesis | yes | 0.0 | 7 |  |  | 3 | mostly reading | check-flash ×9 |
| maths.pure.sequences-series | yes | 0.0 | 6 |  |  | 4 | mostly reading | check-flash ×12 |
| maths.pure.binomial | yes | 0.0 | 5 |  |  | 1 | mostly reading | check-flash ×3 |
| maths.eng.matrices | yes | 0.02 | 10 |  |  | 3 | mostly reading | check-flash ×9 |
| maths.eng.odes | yes | 0.03 | 29 |  |  | 3 | mostly reading | check-flash ×9, widget-num-nohide |
| fluids.flow.bernoulli | yes | 0.03 | 15 |  |  | 3 | mostly reading | check-flash ×9, num-fewdraws |
| mechanical.dynamics.rotation | yes | 0.03 | 12 |  |  | 3 | mostly reading | check-flash ×8 |
| fluids.heat.thermodynamics | yes | 0.04 | 12 |  |  | 2 | mostly reading | check-flash ×6 |
| physics.fields.magnetic | yes | 0.04 | 10 |  |  | 4 | mostly reading | check-flash ×6 |
| mechanical.dynamics.energy | yes | 0.04 | 9 |  |  | 3 | mostly reading | check-flash ×9 |
| maths.stats.probability | yes | 0.04 | 8 |  |  | 3 | mostly reading | check-flash ×9, num-fewdraws |
| physics.elec.emf | yes | 0.06 | 17 |  |  | 1 | mostly reading | check-flash ×3 |
| software.csharp.wpf | yes | 0.07 | 43 |  |  | 2 | mostly reading |  |
| software.tools.sql | yes | 0.07 | 43 |  |  | 2 | mostly reading |  |
| physics.elec.oscilloscope | yes | 0.07 | 41 |  |  | 1 | mostly reading |  |
| physics.measure.uncertainties | yes | 0.07 | 15 |  |  | 1 | mostly reading | check-flash ×3 |
| physics.waves.progressive | yes | 0.07 | 8 |  |  | 2 | mostly reading | check-flash ×6 |
| instrumentation.theory.digital | yes | 0.09 | 34 |  |  | 2 | mostly reading | num-fewdraws |
| electronics.parts.power | yes | 0.09 | 33 |  |  | 2 | mostly reading |  |
| maths.eng.fourier | yes | 0.09 | 32 |  |  | 1 | mostly reading |  |
| mechanical.elements.friction | yes | 0.09 | 11 |  |  | 1 | mostly reading | check-flash ×3 |
| instrumentation.loops.step-tests | yes | 0.1 | 31 |  |  | 3 | mostly reading |  |
| fluids.pneumatics.circuits | yes | 0.1 | 29 |  |  | 1 | mostly reading |  |
| fluids.heat.transfer | yes | 0.1 | 13 |  |  | 3 | mostly reading | check-flash ×9 |
| electrical.protection.protective-devices | yes | 0.11 | 35 |  |  | 3 | mostly reading |  |
| instrumentation.process.valves | yes | 0.11 | 28 |  |  | 5 | mostly reading |  |
| electrical.supply.harmonics | yes | 0.11 | 27 |  |  | 1 | mostly reading |  |
| instrumentation.sensors.temperature | yes | 0.11 | 27 |  |  | 4 | mostly reading | num-fewdraws |
| physics.fields.induction | yes | 0.11 | 12 |  |  | 4 | mostly reading | check-flash ×7 |
| instrumentation.sensors.pressure-level-flow | yes | 0.12 | 34 |  |  | 5 | mostly reading |  |
| drives.motion.gearing | yes | 0.12 | 26 |  |  | 2 | mostly reading |  |
| materials.materials.metals | yes | 0.12 | 25 |  |  | 2 | mostly reading | num-fewdraws |
| mechanical.strength.fatigue | yes | 0.12 | 25 |  |  | 1 | mostly reading |  |
| software.csharp.testing | yes | 0.12 | 25 |  |  | 2 | mostly reading |  |
| mechanical.elements.bearings | yes | 0.13 | 23 |  |  | 1 | mostly reading |  |
| software.csharp.logging | yes | 0.13 | 23 |  |  | 1 | mostly reading |  |
| software.csharp.patterns | yes | 0.13 | 23 |  |  | 3 | mostly reading |  |
| electrical.supply.transformers | yes | 0.13 | 22 |  |  | 1 | mostly reading | num-fewdraws |
| mechanical.fixings.drawings | yes | 0.13 | 15 |  |  | 1 | mostly reading |  |
| software.systems.security | yes | 0.14 | 28 |  |  | 2 | mostly reading |  |
| mechanical.elements.screws | yes | 0.14 | 22 |  |  | 2 | mostly reading |  |
| electronics.digital.serial | yes | 0.14 | 21 |  |  | 1 | mostly reading | num-fewdraws |
| networks.fieldbus.opcua-mqtt | yes | 0.14 | 21 |  |  | 2 | mostly reading |  |
| software.csharp.architecture | yes | 0.14 | 21 |  |  | 1 | mostly reading |  |
| software.csharp.essentials | yes | 0.14 | 21 |  |  | 3 | mostly reading |  |
| plc.process.analogue | yes | 0.14 | 14 |  |  | 2 | mostly reading |  |
| software.tools.git | yes | 0.15 | 27 |  |  | 2 | mostly reading |  |
| plc.comms.comms | yes | 0.15 | 26 |  |  | 1 | mostly reading |  |
| electrical.supply.three-phase | yes | 0.15 | 20 |  |  | 1 | mostly reading | num-fewdraws |
| mechanical.dynamics.vibration | yes | 0.15 | 9 |  |  | 3 | mostly reading | check-flash ×9 |
| electronics.parts.opamps | yes | 0.16 | 25 |  |  | 1 | mostly reading |  |
| electrical.machines.motor-circuits | yes | 0.16 | 19 |  |  | 1 | mostly reading |  |
| plc.safety.safety | yes | 0.16 | 19 |  |  | 2 | mostly reading |  |
| software.csharp.oo-design | yes | 0.16 | 19 |  |  | 2 | mostly reading | mcq-allabove ×2 |
| plc.process.pid-blocks | yes | 0.17 | 29 |  |  | 2 | mostly reading | mcq-allabove |
| instrumentation.loops.strategies | yes | 0.17 | 24 |  |  | 2 | mostly reading | mcq-allabove |
| instrumentation.theory.block-diagrams | yes | 0.17 | 18 |  |  | 2 | mostly reading |  |
| maths.eng.laplace | yes | 0.17 | 18 |  |  | 1 | mostly reading |  |
| practice.paper.reports | yes | 0.17 | 18 |  |  | 4 | mostly reading |  |
| instrumentation.theory.second-order | yes | 0.17 | 5 |  |  | 1 | mostly reading | check-flash ×3 |
| mechanical.dynamics.condition | yes | 0.18 | 22 |  |  | 1 | mostly reading | num-fewdraws |
| drives.motors.linear | yes | 0.18 | 17 |  |  | 1 | mostly reading |  |
| networks.systems.scada | yes | 0.18 | 17 |  |  | 2 | mostly reading |  |
| maths.mech.moments | yes | 0.19 | 9 |  |  | 2 | mostly reading | check-flash ×2 |
| materials.processes.additive | yes | 0.2 | 30 |  |  | 1 | mostly reading |  |
| safety.law.law | yes | 0.2 | 30 |  |  | 5 | mostly reading |  |
| drives.motors.steppers | yes | 0.2 | 20 |  |  | 1 | mostly reading |  |
| instrumentation.loops.tuning | yes | 0.2 | 20 |  |  | 2 | mostly reading | num-fewdraws |
| instrumentation.process.accuracy | yes | 0.2 | 20 |  |  | 2 | mostly reading |  |
| drives.control.feedforward | yes | 0.2 | 15 |  |  | 1 | mostly reading |  |
| networks.fieldbus.ethercat | yes | 0.2 | 15 |  |  | 1 | mostly reading |  |
| networks.fieldbus.serial | yes | 0.21 | 14 |  |  | 1 | mostly reading |  |
| networks.systems.security | yes | 0.21 | 14 |  |  | 3 | mostly reading |  |
| software.csharp.async | yes | 0.22 | 18 |  |  | 1 | mostly reading |  |
| instrumentation.process.daq | yes | 0.23 | 13 |  |  | 1 | mostly reading | num-fewdraws |
| instrumentation.sensors.load-cells | yes | 0.23 | 13 |  |  | 2 | mostly reading |  |
| safety.safeguards.guards | yes | 0.23 | 13 |  |  | 2 | mostly reading | order-3 |
| software.web.http | yes | 0.23 | 13 |  |  | 1 | mostly reading |  |
| networks.ip.ethernet | yes | 0.23 | 12 |  |  | 1 | mostly reading |  |
| instrumentation.sensors.chain | yes | 0.24 | 17 |  |  | 3 | mostly reading |  |
| electrical.protection.earthing | yes | 0.25 | 16 |  |  | 2 | mostly reading | num-fewdraws |
| electronics.parts.filters | yes | 0.25 | 16 |  |  | 1 | mostly reading | num-fewdraws |
| maths.mech.projectiles | yes | 0.25 | 12 |  |  | 1 | mostly reading | check-flash ×3 |
| mechanical.fixings.gdt | yes | 0.25 | 12 |  |  | 1 | mostly reading |  |
| software.systems.real-time | yes | 0.25 | 12 |  |  | 1 | mostly reading |  |
| plc.comms.hmi | yes | 0.25 | 8 |  |  | 1 | mostly reading | mcq-allabove |
| mechanical.fixings.cad | yes | 0.27 | 11 |  |  | 1 | mostly reading |  |
| mechanical.fixings.tolerances | yes | 0.27 | 11 |  |  | 1 | mostly reading | num-novars |
| mechanical.strength.dfma | yes | 0.27 | 11 |  |  | 1 | mostly reading |  |
| networks.ip.tcp-udp | yes | 0.27 | 11 |  |  | 1 | mostly reading |  |
| safety.proof.technical-file | yes | 0.27 | 11 |  |  | 3 | mostly reading |  |
| safety.law.rams | yes | 0.29 | 21 |  |  | 2 | mostly reading |  |
| electronics.digital.micro | yes | 0.29 | 14 |  |  | 2 | mostly reading | num-fewdraws |
| materials.materials.composites | yes | 0.3 | 23 |  |  | 1 | mostly reading |  |
| instrumentation.theory.bode | yes | 0.3 | 10 |  |  | 1 | mostly reading | num-fewdraws |
| software.web.javascript | yes | 0.3 | 10 |  |  | 1 | mostly reading | mcq-allabove |
| electrical.protection.testing | yes | 0.31 | 13 |  |  | 1 | mostly reading |  |
| electronics.signals.emc | yes | 0.33 | 12 |  |  | 2 | mostly reading | mcq-allabove ×2 |
| mechanical.elements.guides | yes | 0.33 | 9 |  |  | 1 | mostly reading | mcq-allabove |
| software.web.historians | yes | 0.33 | 9 |  |  | 2 | mostly reading |  |
| materials.materials.corrosion | yes | 0.33 | 6 |  |  | 1 | mostly reading | check-flash ×3 |
| mechanical.strength.beams | yes | 0.36 | 11 |  |  | 1 | mostly reading | check-flash |
| instrumentation.theory.stability | yes | 0.38 | 8 |  |  | 1 | mostly reading |  |
| ndt.ut.phased-array | yes | 0.38 | 8 |  |  | 2 | mostly reading |  |
| safety.law.risk | yes | 0.38 | 7 |  |  | 3 | mostly reading |  |
| instrumentation.loops.alarms | yes | 0.44 | 9 |  |  | 2 | mostly reading |  |
| physics.ut.generation | yes | 0.5 | 10 |  |  | 1 | mostly reading | mcq-longest |
| networks.ip.wireshark | yes | 0.5 | 6 |  |  | 1 | fair |  |
| plc.lang.st | yes | 0.56 | 9 |  |  | 2 | mostly reading |  |
| materials.materials.heat-treatment | yes | 0.6 | 10 |  |  | 1 | mostly reading |  |
| plc.lang.state-machines | yes | 0.6 | 5 |  |  | 1 | fair |  |
| software.tools.ci | yes | 0.6 | 5 |  |  | 1 | fair | mcq-allabove |
| software.web.data-structures | yes | 0.6 | 5 |  |  | 1 | fair | mcq-longest |
| electrical.hazardous.atex | yes | 0.71 | 7 |  |  | 3 | mostly reading |  |
| fluids.hydraulics.servo | yes | 0.75 | 4 |  |  | 1 | fair |  |
| materials.processes.machining | yes | 0.75 | 4 |  |  | 1 | fair |  |
| networks.systems.pcs | yes | 0.75 | 4 |  |  | 1 | fair |  |
| plc.lang.fbd-sfc | yes | 0.75 | 4 |  |  | 2 | fair |  |
| mechanical.strength.torsion | yes | 0.8 | 4 |  |  | 1 | fair |  |
| materials.quality.quality | yes | 1.0 | 3 |  |  | 1 | good |  |
| instrumentation.loops.batch | yes | 1.5 | 2 |  |  | 1 | good |  |
| drives.motors.dc |  | 2.38 | 1 |  | 3 | 4 | good | mcq-allabove |
| maths.mech.forces |  | 2.38 | 1 | worked, faded | 3 | 3 | good |  |
| drives.motors.servo |  | 2.5 | 1 |  | 3 | 7 | good | num-fewdraws, widget-num-nohide |
| ndt.methods.methods |  | 2.5 | 1 |  |  | 5 | good | mcq-allabove |
| drives.motion.inertia |  | 2.57 | 1 | worked, faded | 3 | 3 | good | num-fewdraws ×2 |
| maths.found.fractions |  | 2.57 | 1 | worked, faded | 3 | 5 | good | widget-num-nohide ×3 |
| maths.found.graphs |  | 2.57 | 1 | worked, faded | 3 | 3 | good | mcq-allabove, num-novars, widget-num-nohide |
| maths.found.number |  | 2.57 | 1 | worked, faded | 3 | 4 | good |  |
| maths.found.powers |  | 2.57 | 1 | worked, faded | 3 | 4 | good | num-fewdraws ×3 |
| maths.found.ratio |  | 2.57 | 1 | worked, faded | 3 | 5 | good | mcq-allabove, num-fewdraws ×2, widget-num-nohide |
| maths.mech.kinematics |  | 2.57 | 1 | worked, faded | 3 | 3 | good |  |
| maths.pure.differentiation |  | 2.62 | 2 | worked, faded | 4 | 4 | good | check-flash ×3, num-fewdraws ×3, widget-num-nohide |
| software.tools.linux |  | 2.62 | 1 | worked, faded | 3 | 4 | good | mcq-allabove, num-novars ×4, order-3 |
| drives.motion.homing |  | 2.67 | 1 |  |  | 4 | good |  |
| maths.pure.proof |  | 2.67 | 1 |  | 2 | 3 | good | mcq-allabove, num-novars ×2 |
| drives.feedback.encoders |  | 2.71 | 1 | worked, faded | 3 | 8 | good | num-fewdraws, widget-num-nohide ×2 |
| drives.motors.vf-vector |  | 2.71 | 1 |  | 3 | 5 | good | num-novars |
| electrical.safety.isolation |  | 2.71 | 1 | worked, faded | 3 | 7 | good | mcq-allabove, num-fewdraws, num-novars ×3 |
| electrical.supply.ac-power |  | 2.71 | 1 | worked, faded | 3 | 5 | good | mcq-allabove ×2, num-fewdraws ×2, widget-num-nohide |
| electronics.dc.ohm-kirchhoff |  | 2.71 | 1 | worked, faded | 3 | 3 | good | num-fewdraws |
| electronics.digital.logic |  | 2.71 | 1 | worked, faded | 3 | 3 | good | num-fewdraws ×3 |
| fluids.pneumatics.basics |  | 2.71 | 1 |  | 3 | 4 | good | mcq-allabove, num-fewdraws ×2 |
| instrumentation.process.pid-diagrams |  | 2.71 | 1 |  |  | 3 | good |  |
| materials.processes.welding |  | 2.71 | 1 | worked | 3 | 5 | good |  |
| maths.found.measures |  | 2.71 | 1 | worked, faded | 4 | 4 | good | num-fewdraws ×4 |
| maths.found.shapes |  | 2.71 | 1 | worked, faded | 4 | 3 | good | num-fewdraws ×2 |
| maths.pure.algebra-functions |  | 2.71 | 1 | worked, faded | 3 | 2 | good | widget-num-nohide ×2 |
| physics.elec.capacitors |  | 2.71 | 1 | worked, faded | 3 | 3 | good | num-fewdraws |
| physics.elec.resistance |  | 2.71 | 1 | worked, faded | 3 | 3 | good | num-fewdraws |
| physics.waves.refraction |  | 2.71 | 1 | worked, faded | 3 | 3 | good | mcq-allabove, num-fewdraws ×7 |
| materials.materials.properties |  | 2.8 | 1 |  |  | 5 | good |  |
| physics.elec.dividers |  | 2.83 | 1 | worked, faded | 3 | 3 | good |  |
| physics.ut.attenuation |  | 2.83 | 1 | worked, faded | 3 | 4 | good | num-fewdraws |
| maths.found.algebra |  | 2.86 | 1 | worked, faded | 3 | 2 | good | mcq-allabove, num-novars |
| maths.found.formulas |  | 2.86 | 1 | worked, faded | 3 | 4 | good |  |
| mechanical.elements.gears-belts |  | 2.86 | 1 | worked, faded | 3 | 3 | good | mcq-allabove, num-fewdraws |
| ndt.ut.immersion |  | 2.86 | 1 |  | 3 | 4 | good | num-fewdraws ×3 |
| software.tools.python |  | 2.86 | 1 | worked, faded | 3 | 3 | good |  |
| electronics.bench.test-gear |  | 3.0 | 1 | worked, faded | 3 | 4 | good | num-fewdraws |
| electronics.digital.adc-dac |  | 3.0 | 1 | worked, faded | 3 | 4 | good | num-fewdraws ×3 |
| electronics.digital.pwm |  | 3.0 | 1 | worked, faded | 3 | 3 | good | num-fewdraws |
| electronics.parts.diodes |  | 3.0 | 1 | worked | 3 | 3 | good | num-fewdraws ×6 |
| electronics.parts.transistors |  | 3.0 | 1 | worked, faded | 3 | 3 | good | mcq-allabove, num-fewdraws |
| maths.eng.complex |  | 3.0 | 1 | worked, faded | 3 | 3 | good | num-fewdraws |
| mechanical.fixings.fasteners |  | 3.0 | 1 | worked, faded | 3 | 5 | good | num-fewdraws ×5 |
| mechanical.strength.stress |  | 3.0 | 1 | worked, faded | 3 | 3 | good | num-fewdraws ×2 |
| networks.ip.addressing |  | 3.0 | 1 | worked, faded | 3 | 5 | good | mcq-allabove ×2, num-fewdraws ×2 |
| physics.elec.charge-current |  | 3.0 | 1 | worked, faded | 3 | 2 | good | mcq-allabove ×2, num-fewdraws ×2 |
| plc.basics.ladder |  | 3.0 | 1 | worked, faded | 4 | 5 | good |  |
| practice.job.fault-finding |  | 3.0 | 1 | worked, faded | 3 | 4 | good | num-fewdraws ×2 |
| practice.job.schematics |  | 3.0 | 1 | worked, faded | 3 | 5 | good | mcq-allabove ×2 |
| drives.control.pid |  | 3.11 | 1 |  | 5 | 5 | good | check-flash ×2, mcq-allabove, widget-num-nohide |
| fluids.flow.pumps-fans |  | 3.17 | 1 | worked, faded | 3 | 4 | good |  |
| fluids.hydraulics.basics |  | 3.17 | 1 | worked, faded | 3 | 4 | good |  |
| instrumentation.sensors.proximity |  | 3.17 | 1 |  | 3 | 4 | good | mcq-allabove, num-fewdraws ×3 |
| plc.basics.data-types |  | 3.17 | 1 |  |  | 4 | good | check-flash, num-novars |
| plc.basics.scan-cycle |  | 3.2 | 1 | worked, faded | 3 | 4 | good | check-flash ×2 |
| electronics.signals.sensors |  | 3.29 | 1 | worked, faded | 3 | 5 | good |  |
| drives.motion.profiles |  | 3.33 | 1 | worked, faded | 4 | 5 | good | widget-num-nohide ×2 |
| maths.pure.trigonometry |  | 3.33 | 1 | worked, faded | 4 | 2 | good | widget-num-nohide |
| physics.elec.ac |  | 3.33 | 1 | worked, faded | 4 | 3 | good | num-fewdraws ×7, widget-num-nohide |
| physics.elec.circuits |  | 3.33 | 1 | worked, faded | 4 | 1 | good | mcq-allabove, num-fewdraws ×2 |
| physics.ut.impedance |  | 3.4 | 1 | worked, faded | 3 | 4 | good | check-flash ×2 |
| drives.power.braking |  | 3.5 | 1 | worked, faded | 4 | 3 | good |  |
| drives.practice.params |  | 3.5 | 1 |  | 3 | 4 | good | num-fewdraws |
| plc.basics.edges |  | 3.6 | 1 | worked, faded | 4 | 4 | good | mcq-allabove, widget-num-nohide |
| drives.motors.induction |  | 3.83 | 1 |  | 4 | 3 | good | widget-num-nohide |
| plc.basics.timers-counters |  | 4.2 | 1 | worked, faded | 4 | 4 | good |  |
| physics.ut.pulse-echo |  | 5.25 | 1 | worked, faded | 5 | 4 | good | check-flash ×2, widget-num-nohide |
