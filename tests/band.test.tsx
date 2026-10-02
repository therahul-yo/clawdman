import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('Ghostty gets a real picture on a two row band', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  const ui = await $.ui.mount({ plugin: 'clawdman', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('tmux and unknown terminals get the block version', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-1/default,1,0' })
  const ui = await $.ui.mount({ plugin: 'clawdman', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('the band draws Clawdman on the terminal', async $ => {
  const ui = await $.ui.mount({ plugin: 'clawdman', surface: 'terminal', ...BAND })
  const picture = (await ui.find({ type: 'Image' })) ?? (await ui.find({ type: 'Raster' }))

  expect(picture).toBeDefined()
  await ui.unmount()
})

test('the band stays out of the way of a survey and of a narrow terminal', async ($, on) => {
  // what the engine itself draws when no plugin does
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  const survey = await $.ui.mount({
    plugin: 'clawdman',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await survey.find({ type: 'Raster' })).toBeUndefined()
  expect(await survey.find({ type: 'Image' })).toBeUndefined()
  await survey.unmount()

  const narrow = await $.ui.mount({
    plugin: 'clawdman',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, bodyColumns: 20 },
  })
  expect(await narrow.find({ type: 'Raster' })).toBeUndefined()
  expect(await narrow.find({ type: 'Image' })).toBeUndefined()
  await narrow.unmount()
})

test('the picture has a text alternative for anyone who cannot see it', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  const ui = await $.ui.mount({ plugin: 'clawdman', surface: 'terminal', ...BAND })
  const picture = await ui.find({ type: 'Image' })

  expect(picture?.props.alt).toBe('Clawdman, a small orange mascot')
  await ui.unmount()
})
