#!/bin/sh
# Pass environment variables to cron
printenv | grep -v "no_proxy" >> /etc/environment
echo "Starting cron..."
cron && tail -f /var/log/task-scheduler.log
