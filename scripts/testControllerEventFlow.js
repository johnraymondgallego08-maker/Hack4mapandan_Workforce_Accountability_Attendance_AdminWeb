const controller = require('../controllers/eventAnnouncementController');
const model = require('../models/eventAnnouncementModel');

function makeReq(body = {}, params = {}) {
  return {
    body,
    params,
    file: undefined,
    flash: () => {}
  };
}

const res = {
  redirect: (p) => { console.log('[res.redirect]', p); },
  render: () => {},
  status: (s) => ({ send: (m) => console.log('[res.status.send]', s, m) })
};

async function run() {
  try {
    const title = `Controller E2E Test ${Date.now()}`;
    console.log('Create title:', title);

    const reqCreate = makeReq({
      type: 'event',
      title,
      summary: 'Summary from controller test',
      content: 'Content from controller test',
      eventDate: new Date().toISOString().slice(0,10),
      eventTime: '13:37',
      location: 'Test Location',
      status: 'Public'
    });

    await controller.createEvent(reqCreate, res);

    // allow Firestore eventual consistency if any
    const records = await model.getAll();
    const created = records.find(r => r.title === title);
    if (!created) {
      console.error('Created record not found');
      process.exit(2);
    }
    console.log('Created record id:', created.id);

    // Update
    const newTitle = title + ' (Updated)';
    const reqUpdate = makeReq({
      type: 'event',
      title: newTitle,
      summary: 'Updated summary',
      content: 'Updated content',
      eventDate: created.eventDateInput || new Date().toISOString().slice(0,10),
      eventTime: '14:00',
      location: 'New Location',
      status: 'Draft'
    }, { id: created.id });

    await controller.updateEvent(reqUpdate, res);

    const updated = await model.getById(created.id);
    if (!updated || updated.title !== newTitle) {
      console.error('Update failed', updated);
      process.exit(3);
    }
    console.log('Update verified, title:', updated.title);

    // Delete
    const reqDelete = makeReq({}, { id: created.id });
    await controller.deleteEvent(reqDelete, res);

    const afterDelete = await model.getById(created.id);
    if (afterDelete) {
      console.error('Delete failed, record still exists');
      process.exit(4);
    }
    console.log('Delete verified, record removed.');

    console.log('Controller E2E flow passed.');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err && err.stack ? err.stack : err);
    process.exit(5);
  }
}

run();
