# Real-Time Socket.io System Test Guide

## ✅ Prerequisites
- Server running on http://localhost:3000
- You are logged in as Administrator
- Browser DevTools Console is open (F12)

## 🧪 Test 1: Verify Socket.io Connection (5 minutes)

### Step 1: Check Socket.io Diagnostics
1. Open browser DevTools Console (F12 → Console tab)
2. Paste this command:
   ```javascript
   socketDiagnostics.checkConnection()
   ```
3. Expected output:
   ```
   ✅ Socket.io library loaded
   ✅ RealtimeClient loaded
   Socket connected: true
   Socket ID: [UUID]
   Listeners registered: X
   ```

### Step 2: Test Connection Status
1. Run this command:
   ```javascript
   socketDiagnostics.testConnection()
   ```
2. Expected result: `✅ Connected to Socket.io server`

### Step 3: Verify Event Room
1. Run this command:
   ```javascript
   socketDiagnostics.joinEventRoom()
   ```
2. Expected console log: `📡 Joined "events" room`

---

## 🎯 Test 2: Real-Time Event Creation (10 minutes)

### Setup:
1. **Tab A (Listener)**: Open http://localhost:3000/manage-events 
2. **Tab B (Creator)**: Open http://localhost:3000/manage-events in new tab
3. **Console**: Open DevTools in both tabs (F12 → Console)

### Tab A (Listener):
1. Keep this tab open, showing the events table
2. Watch the console for `[EVENTS] Real-time update` messages
3. Watch the table for new rows appearing

### Tab B (Creator):
1. Scroll to "Create New" form at the top
2. Fill in the form:
   - Type: "Event"
   - Status: "Public"
   - Title: "Test Real-Time Event 🚀"
   - Summary: "Testing Socket.io real-time updates"
   - Content: "This event should appear instantly in other tabs"
   - Image: (optional, choose any image file)
   - Event Date: (select any future date)
3. Click "Create" button
4. **DO NOT REFRESH THE PAGE**
5. Watch console for: `[EVENTS] Event created successfully`

### Expected Results:
- **Tab B Console**: Should show AJAX submission success
- **Tab A Table**: Should automatically add new row at top *WITHOUT refresh*
- **Tab A Console**: Should show `[EVENTS] Real-time update - new event created:`
- **Time**: Update should appear within 1-2 seconds

### ❌ If Not Working:
Check console for errors:
```
[REALTIME] ❌ Socket not connected
[EVENTS] Form submitted error
```

---

## 📊 Test 3: Multiple Concurrent Updates (10 minutes)

1. Open **3 browser tabs**, all on /manage-events
2. In Tab C, create 3 events one after another (without refreshing):
   - Event 1: "Morning Meeting"
   - Event 2: "Documentation Update"
   - Event 3: "Team Sync"
3. **Expected**: Both Tab A and Tab B show all 3 new events appearing in real-time

---

## 🔍 Test 4: Edit Form (after create works)

1. In any tab on /manage-events
2. Find an event in the table
3. Click the "Edit" button (pencil icon)
4. Page should navigate to edit form
5. Make a change to any field
6. Click "Update" button
7. **Expected**: 
   - Update completes without page refresh
   - Other tabs show updated event data in real-time

---

## 🗑️ Test 5: Delete Form (after edit works)

1. In any tab, find an event
2. Click "Delete" button (trash icon)
3. Confirm deletion
4. **Expected**:
   - Row removed from table without page refresh
   - Other tabs see row disappear in real-time

---

## 🐛 Debugging Tips

### Check Socket Connection:
```javascript
window.realtime.isConnected  // Should be true
window.realtime.socket?.id   // Should show UUID
```

### Check Event Listeners:
```javascript
window.realtime.listeners.size  // Should show count
```

### See All Console Logs (detailed):
Look for patterns like:
- `[REALTIME] 💚 Connected to server` - Socket.io connected
- `[EVENTS] Joined events room` - Room joined
- `[EVENTS] Form submitted` - Form intercepted
- `[EVENTS] Real-time update` - Data received
- `[REALTIME] 📡 Broadcasting event-created` - Server sent update

### Monitor Network Traffic:
1. Open DevTools → Network tab
2. Filter: "WS" (WebSocket)
3. Should see active WebSocket connection to http://localhost:3000/socket.io
4. Messages tab shows real-time data exchanges

---

## ✨ Success Criteria

All tests pass when:
- ✅ Socket.io diagnostics show connected
- ✅ Event created in Tab B appears in Tab A *instantly*
- ✅ No page refresh happens during any CRUD operation
- ✅ Multiple concurrent updates work
- ✅ Edit and delete forms also work with real-time updates
- ✅ Browser console shows [REALTIME] and [EVENTS] messages
- ✅ WebSocket connection stays active throughout

---

## 📝 If Tests Fail

### Common Issues & Fixes:

**Issue: "Socket not connected"**
- Solution: Refresh page, wait 2-3 seconds for connection
- Check if server is running: `npm start`

**Issue: "Page refreshes after form submit"**
- Solution: Make sure manage-events.ejs form doesn't have `onsubmit` attribute
- Should say: `<form id="createEventForm" action="/manage-events/create" method="POST">`

**Issue: "Events appear but table doesn't update"**
- Solution: Check if Browser JavaScript is parsing the HTML correctly
- Try clearing browser cache (Ctrl+Shift+Delete)

**Issue: "CSRF token error"**
- Solution: Make sure `credentials: 'same-origin'` in fetch()
- Check that hidden CSRF input is in form: `<input name="_csrf" value="..."`

---

## 📋 Test Results Checklist

Copy and fill this out:

```
Test 1 - Socket Diagnostics: [ ] PASS [ ] FAIL
Test 2 - Real-Time Event Creation: [ ] PASS [ ] FAIL
Test 3 - Multiple Concurrent: [ ] PASS [ ] FAIL
Test 4 - Edit Form: [ ] PASS [ ] FAIL
Test 5 - Delete Form: [ ] PASS [ ] FAIL

Overall System Status: [ ] WORKING [ ] NEEDS FIXES
```
