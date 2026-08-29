from fastapi import APIRouter

from nexa_bos_api.api.v1.applications import router as applications_router
from nexa_bos_api.api.v1.auth import router as auth_router
from nexa_bos_api.api.v1.catalog import router as catalog_router
from nexa_bos_api.api.v1.customers import router as customers_router
from nexa_bos_api.api.v1.health import router as health_router
from nexa_bos_api.api.v1.organization import router as organization_router
from nexa_bos_api.api.v1.security_settings import router as security_router
from nexa_bos_api.api.v1.user_types import router as user_types_router
from nexa_bos_api.api.v1.users import router as users_router
from nexa_bos_api.api.v1.workflows import router as workflows_router
from nexa_bos_api.attendance.api import router as attendance_router
from nexa_bos_api.reporting.api import router as reports_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(users_router)
api_v1_router.include_router(user_types_router)
api_v1_router.include_router(security_router)
api_v1_router.include_router(organization_router)
api_v1_router.include_router(customers_router)
api_v1_router.include_router(catalog_router)
api_v1_router.include_router(applications_router)
api_v1_router.include_router(workflows_router)
api_v1_router.include_router(reports_router)
api_v1_router.include_router(attendance_router)
