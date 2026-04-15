const eventModel = require('../models/eventAnnouncementModel');

async function run() {
  try {
    console.log('Starting create test...');

    const payload = {
      type: 'event',
      title: `Automated Test Event ${Date.now()}`,
      summary: 'This is a test summary created by an automated test script.',
      content: 'Test content',
      eventDate: new Date().toISOString(),
      eventTime: '12:00',
      location: 'Test Location',
      status: 'Public',
      imageUrl: null
    };

    const created = await eventModel.create(payload);
    console.log('Created document:', created.id);

    // Verify created object contains expected keys
    if (!created || !created.id) {
      throw new Error('Create returned invalid result');
    }

    // Attempt to delete the created doc to keep test environment clean
    const deleted = await eventModel.delete(created.id);
    console.log('Deleted document:', created.id, 'result=', deleted);

    console.log('Test completed successfully.');
  } catch (err) {
    console.error('Test failed:', err && err.message ? err.message : err);
    process.exitCode = 2;
  }
}

run();
