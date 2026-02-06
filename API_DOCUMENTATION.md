# Munawwara Care API Documentation

This document outlines the available API endpoints in the `mc_backend_app`, including expected inputs and outputs.

**Base URL**: `http://<server-ip>:5000/api`

## 1. Authentication (`/auth`)

### Register User (General)
*   **Endpoint**: `POST /auth/register`
*   **Description**: Registers a new user. Default role is `pilgrim`.
*   **Input**:
    ```json
    {
      "full_name": "John Doe",
      "email": "john@example.com",
      "password": "securepassword123",
      "phone_number": "+966501234567"
    }
    ```

### Register Invited Pilgrim
*   **Endpoint**: `POST /auth/register-invited-pilgrim`
*   **Input**:
    ```json
    {
      "token": "invitation_token_123",
      "full_name": "Jane User",
      "password": "password123",
      "phone_number": "+966555555555"
    }
    ```

### Verify Email
*   **Endpoint**: `POST /auth/verify-email`
*   **Input**: `{"email": "...", "code": "123456"}`

### Login
*   **Endpoint**: `POST /auth/login`
*   **Input**: `{"email": "...", "password": "..."}`
*   **Output**: Returns `token`, `role`, `user_id`, `full_name`.

### Profile Management
*   **Get Profile**: `GET /auth/me`
*   **Update Profile**: `PUT /auth/update-profile` (Multipart form-data: `profile_picture`, `full_name`, `phone_number`)

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

## 4. Admin & Moderator Management (`/admin`)

### Request Moderator Status
*   **Endpoint**: `POST /admin/request-moderator`
*   **Description**: Authenticated user requests upgrade to Moderator role.

### Get Pending Requests (Admin Only)
*   **Endpoint**: `GET /admin/requests`

### Approve Request (Admin Only)
*   **Endpoint**: `PUT /admin/requests/:request_id/approve`
*   **Description**: Upgrades user role to 'moderator' and notifies them.

### Reject Request (Admin Only)
*   **Endpoint**: `PUT /admin/requests/:request_id/reject`

### User Management (Admin Only)
*   **List Users**: `GET /admin/users`
*   **System Stats**: `GET /admin/stats`

---

## 5. Groups (`/groups`)

*Requires Moderator or Admin role*

### Create Group
*   **Endpoint**: `POST /groups/create`
*   **Input**: `{"group_name": "Hajj Group 2024"}`

### Group Dashboard
*   **Endpoint**: `GET /groups/dashboard`
*   **Output**: Groups managed by the user.

### Manage Members
*   **Add Pilgrim**: `POST /groups/:group_id/add-pilgrim`
*   **Remove Pilgrim**: `POST /groups/:group_id/remove-pilgrim`
*   **Leave Group**: `POST /groups/:group_id/leave`
*   **Delete Group**: `DELETE /groups/:group_id`

---

## 6. Invitations (`/invitation`)

### Send Invitation
*   **Endpoint**: `POST /invitation/groups/:group_id/invite`
*   **Input**: `{"email": "...", "role": "pilgrim"}`

### Track Invitations
*   **Endpoint**: `GET /invitation/invitations`

---

## 7. Notifications (`/notifications`)

*   **Get All**: `GET /notifications`
*   **Mark Read**: `PUT /notifications/:id/read`
*   **Mark All Read**: `PUT /notifications/read-all`
