# Contributing

## The thing this project actually needs

Measurements. The whole model hangs off a small number of empirical load
ratings, and every one of them can be improved.

A useful measurement report states:

- Locomotive, and whether it was serviced and cooled at the start
- Total train mass, taken from the job booklet rather than estimated
- Where the climb was, and its grade
- The sustained speed you settled at, or where you stalled
- Weather, and whether you were sanding
- Game build number

Open an issue with those and it goes into the dataset with attribution.

## Code

`js/physics.js` has no DOM references and no dependencies. Keep it that way:
it is the part other people might want to import.

Anything that changes a number must come with a test. If you add a locomotive,
the calibration closure test will pick it up automatically — if your entry is
internally inconsistent, that test will fail, which is the point.

```bash
node --test test/*.test.mjs
```

That runs both suites. `physics.test.mjs` asks whether the model is right;
`sanity.test.mjs` asks whether the site would still work if we published the
repository as it stands — parseable data, unique ids, the fields the model
reads, and no reference to a file that is not there. The deploy will not
publish a commit that fails either.

## Adding a locomotive

Add an entry to `data/locomotives.json` with all required fields. `ratedLoad_t`
and `refSpeed_kmh` must come from the same measurement run, on the same
reference climb as everything else, or the calibration is meaningless.

Mark any estimated field with a matching `*Confidence` key set to `"low"` or
`"medium"`. Estimates are welcome; estimates presented as measurements are not.

## Style

No build step, no framework, no bundler. It is a static site and it should stay
one — that is what makes it survive game updates without maintenance.
