# Checklist безопасности владельца

- [ ] GitHub MFA включена; активные sessions/devices проверены.
- [ ] Vercel MFA включена; team members и active sessions проверены.
- [ ] Neon MFA включена; members, API keys и active sessions проверены.
- [ ] ChatGPT/OpenAI MFA включена; неизвестные устройства удалены.
- [ ] Для каждого сервиса используется отдельный уникальный пароль из password manager.
- [ ] Recovery codes сохранены офлайн в защищённом месте, не в Git, чатах или общей папке.
- [ ] Назначен резервный администратор без общих аккаунтов.
- [ ] Удалены неизвестные устройства, устаревшие токены и доступы бывших сотрудников.
- [ ] Проверены scopes production/preview secrets и дата последней rotation.
- [ ] После bootstrap удалены `FIRST_DIRECTOR_EMAIL`, `FIRST_DIRECTOR_PASSWORD`, `FIRST_DIRECTOR_NAME` из Vercel Production/Preview.

Проверять ежеквартально и после каждого кадрового изменения или security incident.
