# Munawwara Care API Documentation

Complete API reference for the `mc_backend_app` backend.

**Base URL**: `http://<server-ip>:5000/api`

**Authentication**: All protected endpoints require `Authorization: Bearer <token>` header.

---

## Error Handling

All validation errors return HTTP 400 in this format:

```json
{
  "success": false,
  "message": "Validation Error",
  "errors": {
    "field_name": "Human-readable error message"
  }
}
```

General server errors return HTTP 500:

```json
{
  "message": "Server error"
}
```

---

## 1. Authentication (`/auth`)

### 1.1 Register Pilgrim — `POST /auth/register` (Public)

Registers a new pilgrim account. No email verification required.

**Rate Limited**: Yes (`authLimiter`)

**Input** (JSON):
```json
{
  "full_name": "Ahmed Ali",           // Required
  "national_id": "1234567890",        // Required, unique
  "phone_number": "+966501234567",    // Required, unique
  "password": "securepassword123",    // Required, min 6 chars
  "email": "ahmed@example.com",       // Optional, unique if provided
  "medical_history": "Diabetes",      // Optional
  "age": 45,                          // Optional, 0-120
  "gender": "male"                    // Optional: 'male', 'female', 'other'
}
```

**Output** (201):
```json
{
  "success": true,
  "message": "Registration successful. Welcome!",
  "token": "jwt_token",
  "role": "pilgrim",
  "user_id": "pilgrim_id",
  "full_name": "Ahmed Ali"
}
```

---

### 1.2 Register Invited Pilgrim — `POST /auth/register-invited-pilgrim` (Public)

Register via an invitation token (from email invite link).

**Rate Limited**: Yes (`authLimiter`)

**Input** (JSON):
```json
{
  "token": "invitation_verification_token",
  "full_name": "Jane User",
  "password": "password123"
}
```

**Output** (201):
```json
{
  "success": true,
  "message": "Registration successful",
  "token": "jwt_token",
  "role": "pilgrim",
  "full_name": "Jane User",
  "user_id": "pilgrim_id"
}
```

---

### 1.3 Login — `POST /auth/login` (Public)

Login with email, national ID, or phone number. Works for all roles (pilgrim, moderator, admin).

**Rate Limited**: Yes (`authLimiter`)

**Input** (JSON):
```json
{
  "identifier": "ahmed@example.com",  // email, national_id, or phone_number
  "password": "securepassword123"
}
```

**Output** (200):
```json
{
  "token": "jwt_token",
  "role": "pilgrim",
  "user_id": "user_or_pilgrim_id",
  "full_name": "Ahmed Ali"
}
```

---

### 1.4 Get Profile — `GET /auth/me` (Protected)

Returns the authenticated user's profile. Response varies by role.

**Pilgrim Output** (200):
```json
{
  "_id": "...",
  "full_name": "Ahmed Ali",
  "email": "ahmed@example.com",
  "national_id": "1234567890",
  "phone_number": "+966501234567",
  "medical_history": "Diabetes",
  "age": 45,
  "gender": "male",
  "email_verified": true,
  "role": "pilgrim",
  "created_at": "2026-01-01T00:00:00.000Z",
  "moderator_request_status": "none",
  "pending_moderator_request": null
}
```

**Moderator/Admin Output** (200):
```json
{
  "_id": "...",
  "full_name": "Mod Name",
  "email": "mod@example.com",
  "role": "moderator",
  "phone_number": "+966...",
  "profile_picture": "filename.jpg",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

---

### 1.5 Update Profile — `PUT /auth/update-profile` (Protected)

Update user profile fields. Supports profile picture upload for moderators.

**Content-Type**: `multipart/form-data` (if uploading picture) or `application/json`

**Input**:
| Field | Type | Notes |
|-------|------|-------|
| `full_name` | string | Optional |
| `phone_number` | string | Optional |
| `age` | number | Optional (pilgrims only) |
| `gender` | string | Optional (pilgrims only) |
| `medical_history` | string | Optional (pilgrims only) |
| `profile_picture` | file | Optional (moderators only) |

**Output** (200):
```json
{
  "message": "Profile updated successfully",
  "user": { /* updated user object */ }
}
```

---

### 1.6 Update Location — `PUT /auth/location` (Protected)

Update the current user's GPS location (for moderators).

**Input** (JSON):
```json
{
  "latitude": 21.4225,
  "longitude": 39.8262
}
```

**Output** (200):
```json
{
  "message": "Location updated"
}
```

---

### 1.7 Add Email — `POST /auth/add-email` (Protected)

Add or update email address for a pilgrim account.

**Input** (JSON):
```json
{
  "email": "newemail@example.com"
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Email added successfully. Verification code sent."
}
```

---

### 1.8 Send Email Verification — `POST /auth/send-email-verification` (Protected)

Send a 6-digit verification code to the authenticated user's email.

**Input**: None

**Output** (200):
```json
{
  "success": true,
  "message": "Verification code sent to your email"
}
```

---

### 1.9 Verify Email — `POST /auth/verify-email` (Protected)

Verify the email with the 6-digit code.

**Input** (JSON):
```json
{
  "code": "123456"
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

---

### 1.10 Request Moderator — `POST /auth/request-moderator` (Protected)

Request upgrade from pilgrim to moderator role. Requires a verified email.

**Input**: None

**Requirements**:
- Must have email on account
- Email must be verified

**Output** (200):
```json
{
  "success": true,
  "message": "Moderator request submitted successfully"
}
```

---

### 1.11 Register Pilgrim — `POST /auth/register-pilgrim` (Moderator/Admin)

Create a pilgrim account on behalf of a user. Moderator must manage a group.

**Input** (JSON):
```json
{
  "full_name": "New Pilgrim",          // Required
  "national_id": "9876543210",         // Required
  "phone_number": "+966501234567",     // Optional
  "email": "pilgrim@example.com",      // Optional
  "password": "optional_password",     // Optional (auto-generated if omitted)
  "medical_history": "None",           // Optional
  "age": 30,                           // Optional
  "gender": "male"                     // Optional
}
```

**Output** (201):
```json
{
  "message": "Pilgrim registered successfully",
  "pilgrim_id": "...",
  "national_id": "9876543210"
}
```

---

### 1.12 Search Pilgrims — `GET /auth/search-pilgrims` (Moderator/Admin)

Search pilgrims by name, national ID, email, or phone number.

**Rate Limited**: Yes (`searchLimiter`)

**Query Parameters**:
| Param | Default | Notes |
|-------|---------|-------|
| `search` | — | Required, search term |
| `page` | 1 | Optional |
| `limit` | 20 | Optional, max 20 |

> Moderators only see pilgrims they created. Admins see all.

**Output** (200):
```json
{
  "success": true,
  "data": [{ /* pilgrim objects */ }],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1
  }
}
```

---

### 1.13 Get Pilgrim by ID — `GET /auth/pilgrims/:pilgrim_id` (Moderator/Admin)

Get a specific pilgrim's details.

> Moderators only see pilgrims they created. Admins see all.

**Output** (200): Pilgrim object with `_id`, `full_name`, `national_id`, `email`, `phone_number`, `medical_history`, `age`, `gender`, `created_at`.

---

### 1.14 Moderator Request Management (Admin Only)

#### Get Pending Requests — `GET /auth/moderator-requests`
Returns all pending moderator upgrade requests.

**Output** (200):
```json
{
  "success": true,
  "data": [{
    "pilgrim_id": { "full_name": "...", "email": "...", "phone_number": "..." },
    "status": "pending",
    "requested_at": "2026-01-01T00:00:00.000Z"
  }]
}
```

#### Approve Request — `PUT /auth/moderator-requests/:request_id/approve`
Approves the request. Moves pilgrim to User collection with `moderator` role. Creates notification.

#### Reject Request — `PUT /auth/moderator-requests/:request_id/reject`
**Input** (JSON): `{ "notes": "Optional rejection reason" }`
Creates rejection notification for the pilgrim.

---

## 2. Pilgrim Features (`/pilgrim`)

*All routes require pilgrim role.*

### 2.1 Get Profile — `GET /pilgrim/profile`

Returns the full pilgrim profile (excludes password).

---

### 2.2 Get My Group — `GET /pilgrim/my-group`

Returns the pilgrim's assigned group info.

**Output** (200):
```json
{
  "group_name": "Hajj Group 2026",
  "group_id": "...",
  "created_by": { "full_name": "Creator Name" },
  "moderators": [{
    "_id": "...",
    "full_name": "Mod Name",
    "phone_number": "+966...",
    "current_latitude": 21.42,
    "current_longitude": 39.82
  }],
  "pilgrim_count": 10
}
```

**Output** (404): `{ "message": "Not assigned to any group" }`

---

### 2.3 Update Location — `PUT /pilgrim/location`

Update the pilgrim's GPS location and optionally battery level.

**Input** (JSON):
```json
{
  "latitude": 21.4225,       // Required
  "longitude": 39.8262,      // Required
  "battery_percent": 85      // Optional
}
```

**Output** (200):
```json
{
  "message": "Location updated",
  "last_update": "2026-02-09T19:00:00.000Z"
}
```

---

### 2.4 Trigger SOS — `POST /pilgrim/sos`

Send an emergency SOS alert to all moderators in the pilgrim's group.

**Input**: None (uses authenticated pilgrim's info and current location)

**Output** (200):
```json
{
  "message": "SOS alert sent successfully",
  "notified_count": 3
}
```

**Side Effects**: Creates SOS notification for each unique moderator in the group with pilgrim name, phone number, and location data.

---

## 3. Messages (`/messages`)

*All routes require authentication.*

### 3.1 Send Broadcast Message — `POST /messages`

Send a message to all pilgrims in a group.

**Content-Type**: `multipart/form-data` (if file attached) or `application/json`

**Input**:
| Field | Type | Notes |
|-------|------|-------|
| `group_id` | string | Required |
| `type` | string | `text` (default), `voice`, `image`, `tts` |
| `content` | string | Text content (required for text/tts) |
| `is_urgent` | boolean | Optional, default false |
| `original_text` | string | Required for `tts` type |
| `file` | file | Required for `voice`/`image` type |

**Output** (201):
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "group_id": "...",
    "sender_id": { "full_name": "...", "role": "moderator" },
    "sender_model": "User",
    "type": "text",
    "content": "Important update...",
    "is_urgent": false,
    "created_at": "2026-02-09T19:00:00.000Z"
  }
}
```

---

### 3.2 Send Individual Message — `POST /messages/individual`

Send a direct message to a specific pilgrim. Must be a group moderator/creator.

**Content-Type**: `multipart/form-data` (if file attached) or `application/json`

**Input**:
| Field | Type | Notes |
|-------|------|-------|
| `group_id` | string | Required |
| `recipient_id` | string | Required (pilgrim ID) |
| `type` | string | `text`, `voice`, `image`, `tts` |
| `content` | string | Text content |
| `is_urgent` | boolean | Optional |
| `original_text` | string | For `tts` type |
| `file` | file | For `voice`/`image` type |

**Output** (201): Same format as broadcast message, includes `recipient_id`.

---

### 3.3 Get Group Messages — `GET /messages/group/:group_id`

Retrieve messages for a group with cursor-based pagination.

**Query Parameters**:
| Param | Default | Notes |
|-------|---------|-------|
| `limit` | 50 | Max messages to return |
| `before` | — | ISO timestamp for pagination (get messages before this time) |

**Visibility Rules**:
- **Pilgrims**: See broadcast messages (recipient_id = null) + messages sent directly to them
- **Moderators**: See all messages in the group (broadcasts + individual alerts)

**Output** (200):
```json
{
  "success": true,
  "data": [{
    "_id": "...",
    "group_id": "...",
    "sender_id": { "full_name": "...", "profile_picture": "...", "role": "moderator" },
    "sender_model": "User",
    "type": "text",
    "content": "Hello pilgrims!",
    "is_urgent": false,
    "recipient_id": null,
    "read_by": ["pilgrim_id_1", "pilgrim_id_2"],
    "created_at": "2026-02-09T19:00:00.000Z"
  }]
}
```

---

### 3.4 Get Unread Count — `GET /messages/group/:group_id/unread`

Get the number of unread messages for the authenticated pilgrim in a group.

**Output** (200):
```json
{
  "success": true,
  "unread_count": 5
}
```

---

### 3.5 Mark Messages as Read — `POST /messages/group/:group_id/mark-read`

Mark all messages in a group as read for the authenticated pilgrim.

**Input**: None

**Output** (200):
```json
{
  "success": true
}
```

---

### 3.6 Delete Message — `DELETE /messages/:message_id`

Delete a specific message. Must be the sender or a moderator/creator of the group.

**Output** (200):
```json
{
  "success": true,
  "message": "Message deleted successfully"
}
```

---

## 4. Groups (`/groups`)

*All routes require authentication. Most require moderator/admin role.*

### 4.1 Create Group — `POST /groups/create` (Moderator/Admin)

**Input** (JSON):
```json
{
  "group_name": "Hajj Group 2026"   // Required, 3-100 characters
}
```

**Output** (201):
```json
{
  "_id": "...",
  "group_name": "Hajj Group 2026",
  "group_code": "ABC123",
  "moderator_ids": ["creator_id"],
  "created_by": "creator_id"
}
```

---

### 4.2 Get Dashboard — `GET /groups/dashboard` (Moderator/Admin)

Returns all groups managed by the authenticated user with enriched pilgrim data.

**Query Parameters**:
| Param | Default | Notes |
|-------|---------|-------|
| `page` | 1 | Page number |
| `limit` | 25 | Max 50 |

**Output** (200):
```json
{
  "success": true,
  "data": [{
    "_id": "...",
    "group_name": "...",
    "group_code": "ABC123",
    "pilgrims": [{
      "_id": "...",
      "full_name": "...",
      "national_id": "...",
      "phone_number": "...",
      "location": { "lat": 21.42, "lng": 39.82 },
      "battery_percent": 85,
      "last_updated": "2026-02-09T19:00:00.000Z"
    }]
  }],
  "pagination": { "page": 1, "limit": 25, "total": 3, "pages": 1 }
}
```

---

### 4.3 Get Single Group — `GET /groups/:group_id` (Moderator/Admin)

Returns a single group with enriched pilgrim details. Requester must be a moderator of the group or an admin.

**Output** (200): Group object with full `pilgrims` array (location, battery, personal info).

---

### 4.4 Update Group — `PUT /groups/:group_id` (Moderator/Admin)

**Input** (JSON):
```json
{
  "group_name": "Updated Name"   // Optional
}
```

**Output** (200):
```json
{
  "message": "Group updated successfully",
  "group": { /* updated group object */ }
}
```

---

### 4.5 Delete Group — `DELETE /groups/:group_id` (Moderator/Admin)

Only the group's own moderators can delete it.

**Output** (200):
```json
{
  "message": "Group deleted successfully",
  "group_id": "..."
}
```

---

### 4.6 Join Group — `POST /groups/join` (Any Authenticated User)

Join a group using its unique code. Pilgrims are added to `pilgrim_ids`, moderators to `moderator_ids`.

**Input** (JSON):
```json
{
  "group_code": "ABC123"
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Successfully joined group as member",
  "group": { "_id": "...", "group_name": "...", "role": "member" }
}
```

---

### 4.7 Leave Group — `POST /groups/:group_id/leave` (Moderator/Admin)

Leave a group as a moderator. The group creator cannot leave.

**Output** (200):
```json
{
  "message": "You have left the group"
}
```

**Side Effect**: Creates notification for the group creator.

---

### 4.8 Add Pilgrim to Group — `POST /groups/:group_id/add-pilgrim` (Moderator/Admin)

**Input** (JSON):
```json
{
  "identifier": "email_or_phone_or_national_id"
}
```

**Output** (200):
```json
{
  "message": "Pilgrim added to group successfully",
  "success": true,
  "group": { "_id": "...", "group_name": "...", "pilgrims": [...] }
}
```

---

### 4.9 Remove Pilgrim from Group — `POST /groups/:group_id/remove-pilgrim` (Moderator/Admin)

**Input** (JSON):
```json
{
  "user_id": "pilgrim_id_to_remove"
}
```

**Output** (200):
```json
{
  "message": "Pilgrim removed from group successfully",
  "group": { "_id": "...", "group_name": "...", "pilgrim_ids": [...] }
}
```

---

### 4.10 Get Group QR Code — `GET /groups/:group_id/qr` (Moderator/Admin)

Generate a QR code image for the group's join code.

**Output** (200):
```json
{
  "group_code": "ABC123",
  "qr_code": "data:image/png;base64,..."
}
```

---

### 4.11 Send Group Alert — `POST /groups/send-alert` (Moderator/Admin)

Send a text alert to all pilgrims in a group.

**Input** (JSON):
```json
{
  "group_id": "...",
  "message_text": "Important announcement"   // 1-500 chars
}
```

**Output** (200):
```json
{
  "status": "queued",
  "message": "Alert sent",
  "recipients": 10
}
```

---

### 4.12 Send Individual Alert — `POST /groups/send-individual-alert` (Moderator/Admin)

Send a text alert to a specific user.

**Input** (JSON):
```json
{
  "user_id": "pilgrim_id",
  "message_text": "Please check in"   // 1-500 chars
}
```

**Output** (200):
```json
{
  "status": "queued",
  "message": "Individual alert sent"
}
```

---

## 5. Invitations

*All routes require authentication.*

### 5.1 Send Invitation — `POST /groups/:group_id/invite`

Invite a user to join a group as a moderator via email. Only group moderators can invite.

**Input** (JSON):
```json
{
  "email": "newmod@example.com"
}
```

**Output** (201):
```json
{
  "success": true,
  "message": "Invitation sent successfully",
  "invitation_id": "..."
}
```

**Side Effects**: Sends invitation email + creates in-app notification.

---

### 5.2 Get My Invitations — `GET /invitations`

Returns all invitations for the authenticated user.

**Output** (200):
```json
{
  "success": true,
  "invitations": [{
    "group_id": { "group_name": "..." },
    "inviter_id": { "full_name": "...", "email": "..." },
    "status": "pending",
    "created_at": "2026-01-01T00:00:00.000Z"
  }]
}
```

---

### 5.3 Accept Invitation — `POST /invitations/:id/accept`

Accept a group invitation. Adds the user to the group's moderator list.

**Output** (200):
```json
{
  "success": true,
  "message": "Invitation accepted",
  "group_id": "..."
}
```

**Side Effect**: Creates notification for the inviter.

---

### 5.4 Decline Invitation — `POST /invitations/:id/decline`

Decline a group invitation.

**Output** (200):
```json
{
  "success": true,
  "message": "Invitation declined"
}
```

**Side Effect**: Creates notification for the inviter.

---

## 6. Notifications (`/notifications`)

*All routes require authentication.*

### 6.1 Get Notifications — `GET /notifications`

**Query Parameters**:
| Param | Default | Notes |
|-------|---------|-------|
| `limit` | 20 | Max notifications |
| `skip` | 0 | Offset for pagination |

**Output** (200):
```json
{
  "success": true,
  "notifications": [{
    "_id": "...",
    "type": "sos_alert",
    "title": "SOS Emergency",
    "message": "Ahmed Ali has triggered an SOS alert",
    "read": false,
    "data": { /* extra context */ },
    "created_at": "2026-02-09T19:00:00.000Z"
  }],
  "unread_count": 3,
  "total": 15
}
```

---

### 6.2 Mark as Read — `PUT /notifications/:id/read`

Mark a single notification as read.

**Output** (200):
```json
{
  "success": true,
  "notification": { /* updated notification */ }
}
```

---

### 6.3 Mark All Read — `PUT /notifications/read-all`

Mark all notifications as read for the authenticated user.

**Output** (200):
```json
{
  "success": true,
  "message": "All notifications marked as read"
}
```

---

### 6.4 Delete Read Notifications — `DELETE /notifications/read`

Delete all read notifications for the authenticated user.

**Output** (200):
```json
{
  "success": true,
  "message": "Read notifications deleted"
}
```

---

### 6.5 Delete Single Notification — `DELETE /notifications/:id`

Delete a specific notification.

**Output** (200):
```json
{
  "success": true,
  "message": "Notification deleted"
}
```

---

## 7. Communication Sessions (`/communication`)

*All routes require authentication.*

### 7.1 Start Session — `POST /communication/start-session`

Start a communication session (call or walkie-talkie) in a group.

**Input** (JSON):
```json
{
  "group_id": "...",
  "type": "voice_call"   // 'voice_call', 'video_call', 'walkie_talkie'
}
```

**Output** (201):
```json
{
  "success": true,
  "message": "Session started",
  "session_id": "...",
  "data": { /* session object */ }
}
```

---

### 7.2 Join Session — `POST /communication/join-session`

**Input** (JSON):
```json
{
  "session_id": "..."
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Joined session",
  "session": { /* session object */ }
}
```

---

### 7.3 End Session — `POST /communication/end-session`

End a session. Only the initiator or a moderator/admin can end it.

**Input** (JSON):
```json
{
  "session_id": "..."
}
```

**Output** (200):
```json
{
  "message": "Session ended"
}
```

---

### 7.4 Get Active Sessions — `GET /communication/sessions/:group_id`

Returns all active communication sessions for a group.

**Output** (200):
```json
{
  "success": true,
  "data": [{
    "_id": "...",
    "type": "voice_call",
    "initiated_by": { "full_name": "..." },
    "participants": ["user_id_1", "user_id_2"],
    "status": "active"
  }]
}
```

---

## Appendix

### Notification Types

| Type | Triggered By |
|------|-------------|
| `sos_alert` | Pilgrim triggers SOS |
| `invitation_received` | Moderator sends group invite |
| `invitation_accepted` | Invitee accepts invitation |
| `invitation_declined` | Invitee declines invitation |
| `moderator_left` | Moderator leaves a group |
| `moderator_approved` | Admin approves moderator request |
| `moderator_rejected` | Admin rejects moderator request |
| `group_alert` | Group broadcast alert |
| `individual_alert` | Direct alert to specific user |

### Message Types

| Type | Description | Required Fields |
|------|-------------|----------------|
| `text` | Plain text message | `content` |
| `voice` | Voice recording | `file` (audio) |
| `image` | Image message | `file` (image) |
| `tts` | Text-to-speech | `content`, `original_text` |

### User Roles

| Role | Description |
|------|-------------|
| `pilgrim` | Basic user, stored in Pilgrim collection |
| `moderator` | Group manager, stored in User collection |
| `admin` | System administrator, stored in User collection |

### File Uploads

Files are served statically from `/uploads/` directory:
```
http://<server-ip>:5000/uploads/<filename>
```

Supported upload endpoints:
- `PUT /auth/update-profile` — `profile_picture` field
- `POST /messages` — `file` field (voice/image)
- `POST /messages/individual` — `file` field (voice/image)

### Rate Limiting

| Limiter | Applied To |
|---------|-----------|
| `authLimiter` | Login, Register endpoints |
| `searchLimiter` | Pilgrim search endpoint |
| `generalLimiter` | All group and pilgrim routes |
