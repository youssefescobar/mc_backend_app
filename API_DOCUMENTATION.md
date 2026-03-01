# Munawwara Care API Documentation

Complete API reference for the `mc_backend_app` backend.

**Base URL**: `http://<server-ip>:5000/api`

**Authentication**: All protected endpoints require `Authorization: Bearer <token>` header.

---

## Server Configuration

### Security & Middleware
- **Helmet**: Security headers enabled by default
- **Compression**: Response compression for optimized bandwidth
- **CORS**: Configurable via `CORS_ORIGINS` environment variable (comma-separated URLs), defaults to wildcard in development
- **Request Limits**: 10MB limit for JSON and URL-encoded payloads
- **Request Timeout**: 30 seconds per request
- **Trust Proxy**: Enabled for proper IP detection behind reverse proxies/load balancers
- **Rate Limiting**: 
  - Multi-tier rate limiting system (see Rate Limiting section)
  - Proxy-aware using Express trust proxy setting
  - IPv6 compatible
  - Logged violations with IP tracking
  - Strictest limits on login (5/15min) and registration (10/hour)

### Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `*` |
| `MONGO_URI` | MongoDB connection string | Required |
| `JWT_SECRET` | JWT signing secret | Required |
| `NODE_ENV` | Environment mode (`development`/`production`) | `development` |
| `LOG_LEVEL` | Winston log level (error/warn/info/debug) | `info` |
| `LOG_TO_FILE` | Enable file logging in development | `false` |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Required for push notifications |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | Required for push notifications |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | Required for push notifications |
| `EMAIL_USER` | Gmail SMTP username | Required for email notifications |
| `EMAIL_PASS` | Gmail App Password | Required for email notifications |

### Database Configuration
- **Connection Pool**: 2-10 connections
- **Auto-reconnect**: Enabled with exponential backoff (up to 5 retries)
- **Connection Timeout**: 5 seconds
- **Socket Timeout**: 45 seconds
- **Graceful Shutdown**: Database connections closed properly on server shutdown

### Logging Configuration
- **Development**: Colorized console output with human-readable format
- **Production**: JSON-formatted logs for aggregators (ELK, Datadog, etc.)
- **File Logging**: 
  - Automatic in production
  - Enabled in development via `LOG_TO_FILE=true`
  - Daily rotation with 14-day retention for combined logs
  - 30-day retention for error logs
  - Max file size: 20MB per file
- **Security**: Password, token, and sensitive fields are automatically redacted in logs
- **HTTP Logging**: All requests logged with duration, status code, and sanitized request body on errors (truncated to 500 chars)
- **Metadata**: All logs include environment, hostname, and process ID

### Firebase Configuration
- **Push Notifications**: Uses Firebase Cloud Messaging (FCM) for direct device-to-device push notifications
- **Initialization**: Environment variable based (no service account JSON file needed)
- **Safety Checks**: All Firebase operations validate initialization status before executing
- **Authentication**: Supports Firebase Auth operations via `getAuth()` helper
- **Messaging**: Supports multicast notifications via `getMessaging()` helper
- **Error Handling**: Graceful fallback if Firebase credentials are missing (warnings logged, server continues)
- **Priority Support**: High-priority notifications for urgent messages and incoming calls
- **Data-Only Messages**: Supports silent/data-only notifications for background processing

### Email Configuration
- **Provider**: Gmail SMTP (port 465, SSL)
- **Authentication**: Requires Gmail account with App Password (2FA must be enabled)
- **Retry Logic**: Automatic retry with exponential backoff (up to 3 attempts)
- **Timeouts**: Connection (10s), Greeting (5s), Socket (15s)
- **Templates**: Reusable HTML email templates for consistent branding
- **Validation**: Configuration checked on startup with detailed error logging
- **Health Check**: `isEmailServiceReady()` helper to verify email service status
- **Email Types**:
  - Verification codes (6-digit, 10-minute expiry)
  - Group moderator invitations (7-day expiry)
  - Pilgrim group invitations (deep-link enabled for mobile app)

### Authentication & Authorization
- **JWT-based Authentication**: All protected routes require `Authorization: Bearer <token>` header
- **Token Validation**: JWT tokens are verified with detailed error messages:
  - `Token expired` - Token has passed its expiry time
  - `Invalid token format` - Malformed or tampered token
  - `Token not yet valid` - Token used before its "not before" time
- **Role-based Authorization**: Supports role restrictions (admin, moderator, pilgrim)
- **Security Monitoring**: 
  - Failed authentication attempts tracked per IP address
  - Security alerts logged after 10+ failed attempts from same IP
  - Automatic cleanup of tracking data after 1 hour
- **Startup Validation**: JWT_SECRET environment variable checked on startup (server exits if missing)
- **Debug Logging**: Successful authentications logged only when `LOG_LEVEL=debug` to reduce log volume

### Response Formats
All API responses include a `success` boolean field. Successful responses return `success: true` with relevant data. Error responses return `success: false` with error details.

---

## Data Model Architecture

### User Model Consolidation (v2.0)

**Important Change**: The system now uses a single unified `User` model instead of separate `User` and `Pilgrim` models.

**User Types**:
- `user_type` enum: `'admin'`, `'moderator'`, `'pilgrim'`
- All users (including pilgrims) are stored in the `users` collection
- The `role` field in responses is a virtual property that maps to `user_type` for backward compatibility

**Pilgrim-Specific Fields**:
The unified User model includes optional fields that are primarily for pilgrims:
- `national_id`: National ID number (unique, required for pilgrims)
- `age`: Age in years (0-120)
- `gender`: 'male', 'female', or 'other'
- `medical_history`: Medical information (max 500 chars)
- `language`: Preferred language (en, ar, ur, fr, id, tr)
- `battery_percent`: Current device battery level
- `email_verified`: Email verification status
- `created_by`: User ID of the moderator who created this pilgrim

**Location Tracking** (All Users):
- `current_latitude`: GPS latitude (-90 to 90)
- `current_longitude`: GPS longitude (-180 to 180)
- `last_location_update`: Timestamp of last location update
- `is_online`: Real-time online status (updated via WebSocket)
- `last_active_at`: Last activity timestamp

**Common Fields** (All Users):
- `full_name`: User's full name
- `email`: Email address (optional, unique if provided)
- `phone_number`: Phone number (required, unique)
- `password`: Hashed password (bcrypt)
- `profile_picture`: Profile picture filename
- `fcm_token`: Firebase Cloud Messaging token for push notifications
- `active`: Account active status
- `user_type`: User role/type (admin, moderator, pilgrim)

**Model References**:
All model relationships now reference the `User` model:
- `Group.pilgrim_ids` → `[ObjectId ref: 'User']`
- `Group.moderator_ids` → `[ObjectId ref: 'User']`
- `Message.sender_id` → `ObjectId ref: 'User'`
- `Message.recipient_id` → `ObjectId ref: 'User'`
- `Notification.user_id` → `ObjectId ref: 'User'`
- `CallHistory.caller_id` & `receiver_id` → `ObjectId ref: 'User'`
- `CommunicationSession.initiator_id` → `ObjectId ref: 'User'`

**Migration Notes**:
- Old `role` field is maintained as a virtual property for backward compatibility
- All enum fields that previously had `'Pilgrim'` now only use `'User'`
- Client applications should transition to using `user_type` instead of `role`

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

Route not found errors return HTTP 404:

```json
{
  "success": false,
  "message": "Cannot GET /api/invalid-route"
}
```

Authentication errors return HTTP 401:

```json
{
  "success": false,
  "message": "Token expired"
}
```

Authorization errors return HTTP 403:

```json
{
  "success": false,
  "message": "Access denied. Required role: admin or moderator"
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

Registers a new pilgrim account (creates a User with `user_type: 'pilgrim'`). No email verification required.

**Rate Limited**: Yes (`registerLimiter` - 10 requests/hour)

**Input** (JSON):
```json
{
  "full_name": "Ahmed Ali",           // Required
  "national_id": "1234567890",        // Required, unique
  "phone_number": "+966501234567",    // Required, unique
  "password": "securepassword123",    // Required, min 8 chars with complexity
  "email": "ahmed@example.com",       // Optional, unique if provided
  "medical_history": "Diabetes",      // Optional
  "age": 45,                          // Optional, 0-120
  "gender": "male"                    // Optional: 'male', 'female', 'other'
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Registration successful. Welcome!",
  "token": "jwt_token",
  "role": "pilgrim",                  // Virtual property, actual field is user_type
  "user_id": "user_id",
  "full_name": "Ahmed Ali"
}
```

**Notes**:
- Password must be 8+ characters with at least one uppercase, lowercase, and number
- `role` in response is a virtual property that reflects `user_type`

--- Creates a User with `user_type: 'pilgrim'`.

**Rate Limited**: Yes (`registerLimiter` - 10 requests/hour)

**Input** (JSON):
```json
{
  "token": "invitation_verification_token",
  "full_name": "Jane User",
  "password": "password123"          // Min 8 chars with complexity
}
```

**Output** (200):
```json
{
  "success": true,
  "message": "Registration successful",
  "token": "jwt_token",
  "role": "pilgrim",                 // Virtual property
  "full_name": "Jane User",
  "user_id": "useration successful",
  "token": "jwt_token",
  "role": "pilgrim",
  "full_name": "Jane User",
  "user_id": "pilgrim_id"
}
```

---

### 1.3 Login — `POST /auth/login` (Public)

**Rate Limited**: Yes (`loginLimiter` - 5 requests/15 minutes, skips successful logins)

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

Returns the authenticated user's profile. Response varies by `user_type`.

**Pilgrim Output** (200):
```json
{
  "success": true,
  "message": null,
  "data": {
    "_id": "...",
    "full_name": "Ahmed Ali",
    "email": "ahmed@example.com",
    "national_id": "1234567890",
    "phone_number": "+966501234567",
    "medical_history": "Diabetes",
    "age": 45,
    "gender": "male",
    "language": "en",
    "email_verified": true,
    "user_type": "pilgrim",
    "role": "pilgrim",                    // Virtual property
    "current_latitude": 21.4225,
    "current_longitude": 39.8262,
    "battery_percent": 85,
    "is_online": true,
    "active": true,
    "created_at": "2026-01-01T00:00:00.000Z",
    "moderator_request_status": "none",   // 'none', 'pending', 'approved', 'rejected'
    "pending_moderator_request": null
  }
}
```

**Moderator/Admin Output** (200):
```json
{
  "success": true,
  "message": null,
  "data": {
    "_id": "...",/admins.

**Content-Type**: `multipart/form-data` (if uploading picture) or `application/json`

**Input**:
| Field | Type | Notes |
|-------|------|-------|
| `full_name` | string | Optional, min 3 chars, max 100 |
| `phone_number` | string | Optional, must be unique |
| `age` | number | Optional, 0-120 (pilgrims only) |
| `gender` | string | Optional: male/female/other (pilgrims only) |
| `medical_history` | string | Optional, max 500 chars (pilgrims only) |
| `profile_picture` | file | Optional (moderators/admins only), jpg/png |

**Output** (200):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": { /* updated user object with user_type field */ }
  }
}
```

**Security**:
- File uploads validated using magic numbers (not just extensions)
- Allowed formats: JPG, PNG
- Max file size: 10MB
- Files sanitized and renamed cryptographically

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

*All routes require authentication and include input validation.*

**Security Enhancements (v2.0)**:
- All endpoints now include Joi validation for request bodies
- Group membership verification on all operations
- Enhanced authorization checks (initiator, moderator, or admin can end sessions)
- Session status validation before operations

### 7.1 Start Session — `POST /communication/start-session`

Start a communication session (call or walkie-talkie) in a group.

**Validation**: Requires `group_id` and valid `type`

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
  "message": "Session started successfully",
  "data": {
    "session_id": "...",
    "session": { /* session object with initiator_model: 'User' */ }
  }
}
```

**Authorization**: Must be a member of the group (pilgrim or moderator)

---

### 7.2 Join Session — `POST /communication/join-session`

Join an active communication session.

**Validation**: Requires `session_id`

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
  "message": "Joined session successfully",
  "data": {
    "session": { /* session object with participants array */ }
  }
}
```

**Security**: Verifies group membership before allowing join

---

### 7.3 End Session — `POST /communication/end-session`

End a communication session.

**Validation**: Requires `session_id`

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
  "message": "Session ended successfully"
}
```

**Authorization**: Only the session initiator, group moderators, or admin can end a session

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

### User Roles (User Types)

**Updated in v2.0**: All users are now stored in the unified `User` collection with a `user_type` field.

| User Type | Description | Collection |
|-----------|-------------|------------|
| `pilgrim` | Basic user (travelers, pilgrims) | `users` (user_type: 'pilgrim') |
| `moderator` | Group manager, can create groups and manage pilgrims | `users` (user_type: 'moderator') |
| `admin` | System administrator, full access | `users` (user_type: 'admin') |

**Note**: The `role` field in API responses is a virtual property that maps to `user_type` for backward compatibility.

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

All rate limiters include:
- **Proxy Support**: Uses Express `trust proxy` setting to properly detect client IPs behind reverse proxies
- **IPv6 Compatible**: Proper IPv6 address handling using built-in rate limiter key generation
- **Standard Headers**: `RateLimit-*` headers in responses
- **Logging**: Rate limit violations logged with client IP and endpoint
- **Consistent Responses**: JSON format with `success: false`

| Limiter | Window | Max Requests | Applied To | Notes |
|---------|--------|--------------|------------|-------|
| `loginLimiter` | 15 minutes | 5 | Login endpoint | Skips successful requests |
| `registerLimiter` | 1 hour | 10 | Register endpoints | Prevents spam accounts |
| `authLimiter` | 15 minutes | 20 | Other auth endpoints | Skips successful requests |
| `searchLimiter` | 1 minute | 30 | Pilgrim search | Per-minute limit |
| `generalLimiter` | 15 minutes | 200 | Most API routes | Skips health checks |

---

## Changelog

### Version 2.0 (March 2026)

#### Major Changes

**User Model Consolidation**
- ✅ Merged separate `User` and `Pilgrim` models into unified `User` model
- ✅ Added `user_type` enum field: `'admin'`, `'moderator'`, `'pilgrim'`
- ✅ `role` field now a virtual property mapping to `user_type` for backward compatibility
- ✅ All user types stored in single `users` collection
- ✅ Eliminated 70% code duplication between models

**Model Reference Updates**
- ✅ Updated all `ref: 'Pilgrim'` to `ref: 'User'` across all models
- ✅ Updated enum fields: `sender_model`, `caller_model`, `receiver_model` now only use `'User'`
- ✅ Consolidated indexes for better query performance

**Controller Improvements**
- ✅ **auth_controller.js**: Migrated all Pilgrim references to User with user_type filters
- ✅ **profile_controller.js**: Complete rewrite - unified profile management for all user types
- ✅ **communication_controller.js**: Added standardized responses, enhanced security, group membership verification
- ✅ **message_controller.js**: Updated sender_model logic to always use 'User'
- ✅ **group_controller.js**: Updated queries with user_type filters
- ✅ **invitation_controller.js**: Unified user lookup logic
- ✅ **call_history_controller.js**: Updated model references
- ✅ **pilgrim_controller.js**: Deleted - functionality moved to profile_controller

**Route Enhancements**
- ✅ **communication_routes.js**: Added Joi validation schemas for all endpoints
- ✅ **push_notification_routes.js**: Added standardized response helpers
- ✅ **pilgrim_routes.js**: Updated to use profile_controller
- ✅ All routes now use consistent response format

**Security Improvements**
- ✅ **upload_middleware.js**: Enhanced file validation with magic number checking
- ✅ **schemas.js**: Stronger password requirements (8+ chars, complexity)
- ✅ Communication sessions now verify group membership before operations
- ✅ Enhanced authorization checks across all protected endpoints
- ✅ Sanitized error messages to prevent information leakage

**Response Standardization**
- ✅ Created `response_helpers.js` utility with `sendSuccess()`, `sendError()`, `sendServerError()`
- ✅ All controllers updated to use standardized response format
- ✅ Consistent error handling across all endpoints

**Database Utilities**
- ✅ Added `wipe_database.js` script for clean database resets in development
- ✅ Removed duplicate index definitions to eliminate Mongoose warnings

#### Breaking Changes

⚠️ **Database Migration Required**
- Old `pilgrims` collection must be migrated to `users` collection
- All Pilgrim documents need `user_type: 'pilgrim'` field
- Existing User documents need appropriate `user_type` field
- See `MIGRATION_SUMMARY.md` for detailed migration guide

⚠️ **API Response Changes**
- All responses now include `success` boolean field
- Error responses follow standardized format
- Some endpoints changed from 201 to 200 status codes for consistency

⚠️ **Field Name Changes**
- Internal `role` field removed, replaced with `user_type`
- `role` maintained as virtual property for backward compatibility
- Client apps should transition to using `user_type`

#### Deprecated

- ❌ Separate Pilgrim model (merged into User model)
- ❌ `pilgrim_controller.js` (functions moved to `profile_controller.js`)
- ❌ Direct `role` field access (use `user_type` or virtual `role` property)

#### Migration Path

1. **Backup Current Database**
   ```bash
   mongodump --uri="mongodb://..." --out=backup/
   ```

2. **Update Code**
   - Pull latest backend code
   - Run `npm install` to update dependencies
   - Verify environment variables

3. **Run Database Migration**
   - Review `MIGRATION_SUMMARY.md`
   - Prepare migration script based on your data
   - Test migration on staging environment first
   - Execute migration on production with downtime window

4. **Verify Migration**
   - Check all user records have `user_type` field
   - Verify model references updated
   - Test authentication flows for all user types
   - Verify group operations work correctly

5. **Update Client Applications**
   - Update API response parsing to handle new format
   - Transition from `role` to `user_type` where applicable
   - Test all critical user flows

#### Notes

- All changes maintain backward compatibility where possible
- Virtual `role` property ensures existing client code continues to work
- Comprehensive testing recommended before production deployment
- See `MIGRATION_SUMMARY.md` for detailed technical documentation

---

**End of Documentation**
