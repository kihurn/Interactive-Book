import test from 'node:test';
import assert from 'node:assert/strict';
import { LAMPLIT_DESK_THEME } from '../config/theme';
import {
  POT_SPEC,
  checkDesktopBookPropClearances,
  createStylizedLeafGeometry,
  generateValidatedPlantFoliage,
  measureLeafPotClearance,
} from './foliage';

test('procedural plant generator creates high-poly thin leaf meshes with zero pot clipping', () => {
  const foliage = generateValidatedPlantFoliage(POT_SPEC);
  assert.ok(foliage.length >= 24, `Expected >= 24 leaves, got ${foliage.length}`);

  let maxPlantRadius = 0;

  for (const leaf of foliage) {
    const report = measureLeafPotClearance(leaf, POT_SPEC);
    assert.equal(
      report.collides,
      false,
      `Leaf at tier ${leaf.tierIndex} clipped pot (wallGap=${report.minInnerWallGap.toFixed(4)}, rimGap=${report.minRimVerticalGap.toFixed(4)})`,
    );
    assert.ok(
      report.maxOuterRadius <= 0.186,
      `Leaf extended too far radially (${report.maxOuterRadius.toFixed(4)})`,
    );
    if (report.maxOuterRadius > maxPlantRadius) {
      maxPlantRadius = report.maxOuterRadius;
    }

    const geo = createStylizedLeafGeometry(leaf.leaf);
    const posAttr = geo.getAttribute('position');
    const triCount = (geo.getIndex()?.count ?? 0) / 3;
    assert.ok(triCount >= 600, `Expected high-poly stylized leaf (>= 600 tris), got ${triCount}`);
    for (let i = 0; i < posAttr.count; i++) {
      assert.equal(Number.isFinite(posAttr.getX(i)), true);
      assert.equal(Number.isFinite(posAttr.getY(i)), true);
      assert.equal(Number.isFinite(posAttr.getZ(i)), true);
    }
    geo.dispose();
  }

  assert.ok(maxPlantRadius > POT_SPEC.innerRimRadius, 'Outer leaves should arch naturally past pot rim');
});

test('no desktop prop clips or overlaps the open 16:9 book footprint', () => {
  const foliage = generateValidatedPlantFoliage(POT_SPEC);
  const maxPlantLocalRadius = foliage.reduce(
    (max, leaf) => Math.max(max, measureLeafPotClearance(leaf, POT_SPEC).maxOuterRadius),
    0,
  );

  const issues = checkDesktopBookPropClearances({
    pageWidth: LAMPLIT_DESK_THEME.bookDimensions.pageWidth,
    pageHeight: LAMPLIT_DESK_THEME.bookDimensions.pageHeight,
    coverOverhang: LAMPLIT_DESK_THEME.bookDimensions.coverOverhang,
    maxPlantLocalRadius,
    props: LAMPLIT_DESK_THEME.props.desktop,
  });

  assert.deepEqual(issues, [], `Found overlapping props: ${JSON.stringify(issues)}`);
});
