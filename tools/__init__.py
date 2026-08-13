from __future__ import annotations

from langchain_core.tools import BaseTool

from adapters.scheduler.base import BaseSchedulerAdapter
from adapters.storage.base import BaseStorageAdapter
from db.registry import ConnectionRegistry
from storage.code_archive import CodeArchive

from .agent_flow_tools import make_agent_flow_tools
from .analysis_tools import make_analysis_tools
from .db_tools import make_db_tools
from .etl_tools import make_etl_tools
from .export_tools import make_export_tools
from .file_tools import make_file_tools
from .scheduler_tools import make_scheduler_tools
from .semantic_tools import make_semantic_tools
from .viz_tools import make_viz_tools


def get_all_tools(
    registry: ConnectionRegistry,
    storage: BaseStorageAdapter,
    archive: CodeArchive,
    scheduler: BaseSchedulerAdapter,
) -> list[BaseTool]:
    """Assemble the complete tool registry for the QueryMind agent."""
    return [
        *make_agent_flow_tools(registry),
        *make_semantic_tools(registry),
        *make_db_tools(registry),
        *make_analysis_tools(registry),
        *make_etl_tools(archive, storage),
        *make_export_tools(registry),
        *make_file_tools(storage),
        *make_viz_tools(registry),
        *make_scheduler_tools(scheduler),
    ]
