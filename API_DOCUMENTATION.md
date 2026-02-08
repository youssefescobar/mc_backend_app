# Munawwara Care API Documentation

This document outlines the available API endpoints in the `mc_backend_app` (main backend for mobile app). For admin endpoints, see the separate `mc_admin_backend` documentation.

**Base URL**: `http://<server-ip>:5000/api`

## Error Handling & Validation

All API endpoints return errors in the following standard format when validation fails (HTTP 400):

```json
{
  "success": false,
  "message": "Validation Error",
  "errors": {
    "email": "Email is already registered",
    "password": "Password must be at least 6 characters long",
    "phone_number": "Phone number is required"
  }
}
```

The `errors` object key represents the field name, and the value is the human-readable error message.

---

## 1. Authentication (`/auth`)

### Register Pilgrim (Public)
*   **Endpoint**: `POST /auth/register`
*   **Description**: Registers a new pilgrim account. Email is optional. No email verification required.
*   **Input**:
    ```json
    {
      "full_name": "Ahmed Ali",
      "national_id": "1234567890",
      "phone_number": "+966501234567",
      "password": "securepassword123",
      "email": "ahmed@example.com",  // Optional
      "medical_history": "Diabetes",  // Optional
      "age": 45,  // Optional
      "gender": "male"  // Optional: 'male', 'female', 'other'
    }
    ```
*   **Output**: Returns `token`, `role`, `user_id`, `full_name`

### Login
*   **Endpoint**: `POST /auth/login`
*   **Description**: Login with email, national ID, or phone number
*   **Input**:
    ```json
    {
      "identifier": "ahmed@example.com",  // Can be email, national_id, or phone_number
      "password": "securepassword123"
    }
    ```
*   **Output**: Returns `token`, `role`, `user_id`, `full_name`

### Email Management (Protected)

#### Add Email
*   **Endpoint**: `POST /auth/add-email`
*   **Description**: Add or update email for pilgrim account
*   **Headers**: `Authorization: Bearer <token>`
*   **Input**: `{"email": "newemail@example.com"}`

#### Send Email Verification
*   **Endpoint**: `POST /auth/send-email-verification`
*   **Description**: Send 6-digit verification code to pilgrim's email
*   **Headers**: `Authorization: Bearer <token>`

#### Verify Email
*   **Endpoint**: `POST /auth/verify-email`
*   **Description**: Verify email with 6-digit code
*   **Headers**: `Authorization: Bearer <token>`
*   **Input**: `{"code": "123456"}`

### Moderator Request (Protected)
*   **Endpoint**: `POST /auth/request-moderator`
*   **Description**: Request upgrade to moderator role. Requires verified email.
*   **Headers**: `Authorization: Bearer <token>`
*   **Requirements**: 
    - Must have email on account
    - Email must be verified

### Profile Management (Protected)
*   **Get Profile**: `GET /auth/me`
*   **Update Profile**: `PUT /auth/update-profile` (Multipart form-data: `profile_picture`, `full_name`, `phone_number`)
*   **Update Location**: `PUT /auth/location` (Input: `latitude`, `longitude`)

### Register Invited Pilgrim (Public)
*   **Endpoint**: `POST /auth/register-invited-pilgrim`
*   **Description**: Register via invitation link
*   **Input**:
    ```json
    {
      "token": "invitation_token_123",
      "full_name": "Jane User",
      "password": "password123",
      "phone_number": "+966555555555"
    }
    ```

### Moderator/Admin Only Endpoints
*   **Register Pilgrim**: `POST /auth/register-pilgrim` (Create pilgrim for group)
*   **Search Pilgrims**: `GET /auth/search-pilgrims?query=...&page=1&limit=20`
*   **Get Pilgrim**: `GET /auth/pilgrims/:pilgrim_id`

---

## 2. Pilgrim Features (`/pilgrim`)

*All routes require Pilgrim role login*

### Get My Group
*   **Endpoint**: `GET /pilgrim/my-group`
*   **Output**: Returns assigned group, moderators list (with location), and creator info.

### Update Location
*   **Endpoint**: `PUT /pilgrim/location`
*   **Input**:
    ```json
    {
      "latitude": 21.4225,
      "longitude": 39.8262,
      "battery_percent": 85
    }
    ```

### Trigger SOS
*   **Endpoint**: `POST /pilgrim/sos`
*   **Description**: Sends immediate emergency alert to all group moderators.

---

## 3. Messages (`/messages`)

*Used for Group Broadcasts (Moderator -> Pilgrims)*

### Send Message
*   **Endpoint**: `POST /messages`
*   **Headers**: `Authorization: Bearer <token>`, `Content-Type: multipart/form-data` (if file attached)
*   **Input**:
    *   `group_id`: ID of the group.
    *   `content`: Text content.
    *   `type`: 'text', 'voice', or 'image'.
    *   `file`: (Optional) Audio/Image file.

### Get Group Messages
*   **Endpoint**: `GET /messages/group/:group_id`
*   **Query**: `?page=1&limit=50`
*   **Output**: List of messages sorted by date.


---

## 4. Groups (`/groups`)

*Requires Moderator role*

### Create Group
*   **Endpoint**: `POST /groups/create`
*   **Input**: `{"group_name": "Hajj Group 2024"}`
*   **Output**: Returns created group object (including `group_code`).

### Join Group
*   **Endpoint**: `POST /groups/join`
*   **Input**: `{"group_code": "ABC123"}`
*   **Description**: Join an existing group as a member using its unique code.

### Get Group QR Code
*   **Endpoint**: `GET /groups/:group_id/qr`
*   **Description**: Generate QR code for group sharing (Moderators/Admins only)
*   **Headers**: `Authorization: Bearer <token>`
*   **Output**: 
    ```json
    {
      "group_code": "ABC123",
      "qr_code": "data:image/png;base64,..."
    }
    ```

### Group Dashboard
*   **Endpoint**: `GET /groups/dashboard`
*   **Output**: Groups managed by the user.

### Manage Members
*   **Add Pilgrim**: `POST /groups/:group_id/add-pilgrim`
*   **Remove Pilgrim**: `POST /groups/:group_id/remove-pilgrim`
*   **Leave Group**: `POST /groups/:group_id/leave`
*   **Delete Group**: `DELETE /groups/:group_id`

---

## 5. Invitations (`/invitation`)

### Send Invitation
*   **Endpoint**: `POST /invitation/groups/:group_id/invite`
*   **Input**: `{"email": "...", "role": "pilgrim"}`

### Track Invitations
*   **Endpoint**: `GET /invitation/invitations`

---

## 6. Communication Sessions (Calls/Walkie-Talkie)
*   **Start Session**: `POST /communication/start-session`
    *   Input: `{"group_id": "...", "type": "voice_call"}` (Types: `voice_call`, `video_call`, `walkie_talkie`)
    *   Output: `session_id`
*   **Join Session**: `POST /communication/join-session`
    *   Input: `{"session_id": "..."}`
*   **End Session**: `POST /communication/end-session`
    *   Input: `{"session_id": "..."}`
*   **Get Active Sessions**: `GET /communication/sessions/:group_id`

---

## 7. Notifications (`/notifications`)

*   **Get All**: `GET /notifications`
*   **Mark Read**: `PUT /notifications/:id/read`
*   **Mark All Read**: `PUT /notifications/read-all`
