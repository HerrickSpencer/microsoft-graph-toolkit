import { LitElement, customElement, html, property } from 'lit-element';
import { User, PlannerAssignments } from '@microsoft/microsoft-graph-types';
import { Providers } from '../../Providers';
import { ProviderState } from '../../providers/IProvider';
import { getShortDateString } from '../../utils/utils';
import { styles } from './mgt-tasks-css';

import { ITaskSource, PlannerTaskSource, TodoTaskSource, IDresser, IDrawer, ITask } from './task-sources';

import '../mgt-person/mgt-person';
import '../sub-components/mgt-arrow-options/mgt-arrow-options';
import '../sub-components/mgt-dot-options/mgt-dot-options';
import { promised } from 'q';

// Strings and Resources for different task contexts
const TASK_RES = {
  todo: {
    DUE_DATE_TIME: 'T17:00',
    BASE_SELF_ASSIGNED: 'All Tasks',
    PLANS_SELF_ASSIGNED: 'All groups',
    BUCKETS_SELF_ASSIGNED: 'All Folders',
    PLAN_NOT_FOUND: 'Group not found',
    BUCKET_NOT_FOUND: 'Folder not found'
  },
  planner: {
    DUE_DATE_TIME: 'T17:00',
    BASE_SELF_ASSIGNED: 'Assigned to Me',
    PLANS_SELF_ASSIGNED: 'All Plans',
    BUCKETS_SELF_ASSIGNED: 'All Buckets',
    PLAN_NOT_FOUND: 'Plan not found',
    BUCKET_NOT_FOUND: 'Bucket not found'
  }
};

@customElement('mgt-tasks')
export class MgtTasks extends LitElement {
  public get res() {
    switch (this.dataSource) {
      case 'todo':
        return TASK_RES.todo;
      case 'planner':
      default:
        return TASK_RES.planner;
    }
  }

  public static get styles() {
    return styles;
  }

  @property({ attribute: 'read-only', type: Boolean })
  public readOnly: boolean = false;

  @property({ attribute: 'data-source', type: String })
  public dataSource: 'planner' | 'todo' = 'planner';

  @property({ attribute: 'target-id', type: String })
  public targetId: string = null;
  @property({ attribute: 'target-bucket-id', type: String })
  public targetBucketId: string = null;

  @property({ attribute: 'initial-id', type: String })
  public initialId: string = null;
  @property({ attribute: 'initial-bucket-id', type: String })
  public initialBucketId: string = null;

  @property() private _showNewTask: boolean = false;
  @property() private _newTaskBeingAdded: boolean = false;
  @property() private _newTaskSelfAssigned: boolean = true;
  @property() private _newTaskName: string = '';
  @property() private _newTaskDueDate: string = '';
  @property() private _newTaskDresserId: string = '';
  @property() private _newTaskDrawerId: string = '';

  @property() private _dressers: IDresser[] = [];
  @property() private _drawers: IDrawer[] = [];
  @property() private _tasks: ITask[] = [];

  @property() private _currentTargetDresser: string = this.res.BASE_SELF_ASSIGNED;
  @property() private _currentSubTargetDresser: string = this.res.PLANS_SELF_ASSIGNED;
  @property() private _currentTargetDrawer: string = this.res.BUCKETS_SELF_ASSIGNED;

  @property() private _hiddenTasks: string[] = [];
  @property() private _loadingTasks: string[] = [];

  private _me: User = null;

  protected firstUpdated() {
    if (this.initialId && (!this._currentTargetDresser || this.isDefault(this._currentTargetDresser))) {
      this._currentTargetDresser = this.initialId;
      this.initialId = null;
    }

    if (this.initialBucketId && (!this._currentTargetDrawer || this.isDefault(this._currentTargetDrawer))) {
      this._currentTargetDrawer = this.initialBucketId;
      this.initialBucketId = null;
    }

    this.loadTasks();
  }

  public attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === 'data-source') this.loadTasks();
  }

  constructor() {
    super();
    Providers.onProviderUpdated(() => this.loadTasks());
  }

  private async loadTasks() {
    let ts = this.getTaskSource();
    if (!ts) return;

    this._me = await ts.me();

    if (this.targetId) {
      if (this.dataSource === 'todo') {
        let dressers = await ts.getMyDressers();
        let drawers = (await Promise.all(dressers.map(dresser => ts.getDrawersForDresser(dresser.id)))).reduce(
          (cur, ret) => [...cur, ...ret],
          []
        );
        let tasks = (await Promise.all(
          drawers.map(drawer => ts.getAllTasksForDrawer(drawer.id, drawer.parentId))
        )).reduce((cur, ret) => [...cur, ...ret], []);

        this._tasks = tasks;
        this._drawers = drawers;
        this._dressers = dressers;

        this._currentTargetDresser = drawers[0].id;
        this._currentTargetDrawer = this.targetId;
      } else {
        let dresser = await ts.getSingleDresser(this.targetId);
        let drawers = await ts.getDrawersForDresser(dresser.id);
        let tasks = (await Promise.all(
          drawers.map(drawer => ts.getAllTasksForDrawer(drawer.id, drawer.parentId))
        )).reduce((cur, ret) => [...cur, ...ret], []);

        this._tasks = tasks;
        this._drawers = drawers;
        this._dressers = [dresser];

        this._currentTargetDresser = this.targetId;
        if (this.targetBucketId) this._currentTargetDrawer = this.targetBucketId;
      }
    } else {
      let dressers = await ts.getMyDressers();
      let drawers = (await Promise.all(dressers.map(dresser => ts.getDrawersForDresser(dresser.id)))).reduce(
        (cur, ret) => [...cur, ...ret],
        []
      );

      let tasks = (await Promise.all(
        drawers.map(drawer => ts.getAllTasksForDrawer(drawer.id, drawer.parentId))
      )).reduce((cur, ret) => [...cur, ...ret], []);

      this._tasks = tasks;
      this._drawers = drawers;
      this._dressers = dressers;
    }
  }

  private async addTask(
    name: string,
    dueDateTime: string,
    topParentId: string,
    immediateParentId: string,
    assignments: PlannerAssignments = {}
  ) {
    let ts = this.getTaskSource();
    if (!ts) return;

    let newTask = {
      topParentId,
      immediateParentId,
      name,
      assignments
    } as ITask;

    if (dueDateTime && dueDateTime !== 'T') newTask.dueDate = this.getDateTimeOffset(dueDateTime + 'Z');

    this._newTaskBeingAdded = true;
    await ts.addTask(newTask);
    await this.loadTasks();
    this._newTaskBeingAdded = false;
    this.closeNewTask(null);
  }

  private async completeTask(task: ITask) {
    let ts = this.getTaskSource();
    if (!ts) return;
    this._loadingTasks = [...this._loadingTasks, task.id];
    await ts.setTaskComplete(task.id, task.eTag);
    await this.loadTasks();
    this._loadingTasks = this._loadingTasks.filter(id => id !== task.id);
  }

  private async uncompleteTask(task: ITask) {
    let ts = this.getTaskSource();
    if (!ts) return;

    this._loadingTasks = [...this._loadingTasks, task.id];
    await ts.setTaskIncomplete(task.id, task.eTag);
    await this.loadTasks();
    this._loadingTasks = this._loadingTasks.filter(id => id !== task.id);
  }

  private async removeTask(task: ITask) {
    let ts = this.getTaskSource();
    if (!ts) return;

    this._hiddenTasks = [...this._hiddenTasks, task.id];
    await ts.removeTask(task.id, task.eTag);
    await this.loadTasks();
    this._hiddenTasks = this._hiddenTasks.filter(id => id !== task.id);
  }

  public openNewTask(e: MouseEvent) {
    this._showNewTask = true;
  }

  public closeNewTask(e: MouseEvent) {
    this._showNewTask = false;

    this._newTaskSelfAssigned = false;
    this._newTaskDueDate = '';
    this._newTaskName = '';
    this._newTaskDresserId = '';
  }

  private taskPlanFilter(task: ITask) {
    return (
      task.topParentId === this._currentTargetDresser ||
      (this.isDefault(this._currentTargetDresser) && this.isAssignedToMe(task))
    );
  }

  private taskSubPlanFilter(task: ITask) {
    return task.topParentId === this._currentSubTargetDresser || this.isDefault(this._currentSubTargetDresser);
  }

  private taskBucketPlanFilter(task: ITask) {
    return task.immediateParentId === this._currentTargetDrawer || this.isDefault(this._currentTargetDrawer);
  }

  protected render() {
    return html`
      <div class="Header">
        <span class="PlannerTitle">
          ${this.renderPlanOptions()}
        </span>
      </div>
      <div class="Tasks">
        ${this._showNewTask ? this.renderNewTaskHtml() : null}
        ${this._tasks
          .filter(task => this.taskPlanFilter(task))
          .filter(task => this.taskSubPlanFilter(task))
          .filter(task => this.taskBucketPlanFilter(task))
          .filter(task => !this._hiddenTasks.includes(task.id))
          .map(task => this.renderTaskHtml(task))}
      </div>
    `;
  }

  private onAddTaskClick(e: MouseEvent) {
    if (
      !this._newTaskBeingAdded &&
      this._newTaskName &&
      (!this.isDefault(this._currentTargetDresser) || this._newTaskDresserId)
    )
      this.addTask(
        this._newTaskName,
        this._newTaskDueDate ? this._newTaskDueDate + this.res.DUE_DATE_TIME : null,
        this.isDefault(this._currentTargetDresser) ? this._newTaskDresserId : this._currentTargetDresser,
        this.isDefault(this._currentTargetDrawer) ? this._newTaskDrawerId : this._currentTargetDrawer,
        this._newTaskSelfAssigned
          ? {
              [this._me.id]: {
                '@odata.type': 'microsoft.graph.plannerAssignment',
                orderHint: 'string !'
              }
            }
          : void 0
      );
  }

  private renderPlanOptions() {
    let p = Providers.globalProvider;

    if (!p || p.state !== ProviderState.SignedIn)
      return html`
        Not Logged In
      `;

    let addButton =
      this.readOnly || this._showNewTask
        ? null
        : html`
            <span
              class="AddBarItem NewTaskButton"
              @click="${(e: MouseEvent) => {
                if (!this._showNewTask) this.openNewTask(e);
                else this.closeNewTask(e);
              }}"
            >
              <span class="TaskIcon">\uE710</span>
              <span>Add</span>
            </span>
          `;

    if (this.dataSource === 'planner') {
      let dresserSelect = this.targetId
        ? html`
            <span class="PlanTitle">
              ${this._dressers[0] && this._dressers[0].title}
            </span>
          `
        : html`
            <select
              .value="${this._currentTargetDresser}"
              @change=${(e: Event & { target: HTMLSelectElement }) => {
                this._currentTargetDresser = e.target.value;
                this._currentTargetDrawer = this.res.BUCKETS_SELF_ASSIGNED;
              }}
            >
              <option value="${this.res.BASE_SELF_ASSIGNED}">${this.res.BASE_SELF_ASSIGNED}</option>
              ${this._dressers.map(
                dresser => html`
                  <option ?selected=${dresser.id === this._currentTargetDresser} value="${dresser.id}"
                    >${dresser.title}</option
                  >
                `
              )}
            </select>
          `;

      let divider = this.isDefault(this._currentTargetDresser)
        ? null
        : html`
            <span class="TaskIcon">\uE76C</span>
          `;

      let drawerSelect = this.targetBucketId
        ? html`
            <span class="PlanTitle">
              ${this._drawers[0] && this._drawers[0].name}
            </span>
          `
        : html`
            <select
              .value="${this._currentTargetDrawer}"
              @change=${(e: Event & { target: HTMLSelectElement }) => {
                this._currentTargetDrawer = e.target.value;
              }}
            >
              <option value="${this.res.BUCKETS_SELF_ASSIGNED}">${this.res.BUCKETS_SELF_ASSIGNED}</option>
              ${this._drawers
                .filter(drawer => drawer.parentId === this._currentTargetDresser)
                .map(
                  drawer => html`
                    <option selected="${drawer.id === this._currentTargetDrawer}" value="${drawer.id}"
                      >${drawer.name}</option
                    >
                  `
                )}
            </select>
          `;

      return html`
        <span class="TitleCont">
          ${dresserSelect} ${divider} ${this.isDefault(this._currentTargetDresser) ? null : drawerSelect}
        </span>
        ${addButton}
      `;
    } else {
      let drawer = this._drawers.find(d => d.id === this.targetId) || { name: 'Tasks' };
      let drawerSelect = this.targetId
        ? html`
            <span class="PlanTitle">
              ${drawer.name}
            </span>
          `
        : html`
            <select
              .value="${this._currentTargetDrawer}"
              @change="${(e: Event & { target: HTMLSelectElement }) => {
                this._currentTargetDrawer = e.target.value;
              }}"
            >
              <option value="${this.res.BUCKETS_SELF_ASSIGNED}">${this.res.BUCKETS_SELF_ASSIGNED}</option>
              ${this._drawers.map(
                drawer => html`
                  <option value="${drawer.id}">${drawer.name}</option>
                `
              )}
            </select>
          `;

      return html`
        <span class="TitleCont">
          ${drawerSelect}
        </span>
        ${addButton}
      `;
    }
  }

  private renderNewTaskHtml() {
    let taskTitle = html`
      <span class="TaskTitle">
        <input
          type="text"
          placeholder="Task..."
          .value="${this._newTaskName}"
          @input="${(e: Event & { target: HTMLInputElement }) => {
            this._newTaskName = e.target.value;
          }}"
        />
      </span>
    `;

    let dressers = this._dressers;
    if (dressers.length > 0 && !this._newTaskDresserId) {
      this._newTaskDresserId = dressers[0].id;
    }
    let taskDresser =
      this.dataSource === 'todo' || !this.isDefault(this._currentTargetDresser)
        ? html`
            <span class="TaskDetail TaskAssignee">
              <span class="TaskIcon">\uF5DC</span>
              <span>${this.getPlanTitle(this._currentTargetDresser)}</span>
            </span>
          `
        : html`
            <span class="TaskDetail TaskAssignee">
              <span class="TaskIcon">\uF5DC</span>
              <select
                .value="${this._newTaskDresserId}"
                @change="${(e: Event & { target: HTMLSelectElement }) => {
                  this._newTaskDresserId = e.target.value;
                }}"
              >
                ${this._dressers.map(
                  plan => html`
                    <option value="${plan.id}">${plan.title}</option>
                  `
                )}
              </select>
            </span>
          `;

    let drawers = this._drawers.filter(
      drawer =>
        (!this.isDefault(this._currentTargetDresser) && drawer.parentId === this._currentTargetDresser) ||
        (this.isDefault(this._currentTargetDresser) && drawer.parentId === this._newTaskDresserId)
    );
    if (drawers.length > 0 && !this._newTaskDrawerId) {
      this._newTaskDrawerId = drawers[0].id;
    }
    let taskDrawer = !this.isDefault(this._currentTargetDrawer)
      ? html`
          <span class="TaskDetail TaskBucket">
            <span class="TaskIcon">\uF1B6</span>
            <span>${this.getDrawerName(this._currentTargetDrawer)}</span>
          </span>
        `
      : html`
          <span class="TaskDetail TaskBucket">
            <span class="TaskIcon">\uF1B6</span>
            <select
              .value="${this._newTaskDrawerId}"
              @change="${(e: Event & { target: HTMLSelectElement }) => {
                this._newTaskDrawerId = e.target.value;
              }}"
            >
              ${drawers.map(
                drawer => html`
                  <option value="${drawer.id}">${drawer.name}</option>
                `
              )}
            </select>
          </span>
        `;

    let taskDue = html`
      <span class="TaskDetail TaskDue">
        <span class="TaskIcon">\uE787</span>
        <input
          type="date"
          .value="${this._newTaskDueDate}"
          @change="${(e: Event & { target: HTMLInputElement }) => {
            this._newTaskDueDate = e.target.value;
          }}"
        />
      </span>
    `;

    let taskPeople = html`
      <span class="TaskDetail TaskPeople">
        <label>
          <span>Assign to Me</span>
          <input
            type="checkbox"
            .checked="${this._newTaskSelfAssigned}"
            @change="${(e: Event & { target: HTMLInputElement }) => {
              this._newTaskSelfAssigned = e.target.checked;
            }}"
          />
        </label>
      </span>
    `;

    let taskAdd = this._newTaskBeingAdded
      ? html`
          <div class="TaskAddCont"></div>
        `
      : html`
          <div class="TaskAddCont ${this._newTaskName === '' ? 'Disabled' : ''}">
            <div class="TaskIcon TaskCancel" @click="${this.closeNewTask}">
              <span>Cancel</span>
            </div>
            <div class="TaskIcon TaskAdd" @click="${this.onAddTaskClick}">
              <span>\uE710</span>
            </div>
          </div>
        `;

    return html`
      <div class="Task NewTask Incomplete">
        <div class="InnerTask">
          <span class="TaskHeader">
            ${taskTitle}
          </span>
          <hr />
          <span class="TaskDetails">
            ${taskDresser} ${taskDrawer} ${taskDue} ${taskPeople}
          </span>
        </div>
        ${taskAdd}
      </div>
    `;
  }

  private renderTaskHtml(task: ITask) {
    let { name = 'Task', completed = false, dueDate, assignments } = task;

    let dueDateString = new Date(dueDate);
    let people = Object.keys(assignments);
    let taskClass = completed ? 'Complete' : 'Incomplete';

    let taskCheck = this._loadingTasks.includes(task.id)
      ? html`
          <span class="TaskCheck TaskIcon Loading">\uF16A</span>
        `
      : completed
      ? html`
          <span class="TaskCheck TaskIcon Complete">\uE73E</span>
        `
      : html`
          <span class="TaskCheck TaskIcon Incomplete"></span>
        `;

    let taskDresser =
      this.dataSource === 'todo' || !this.isDefault(this._currentTargetDresser)
        ? null
        : html`
            <span class="TaskDetail TaskAssignee">
              <span class="TaskIcon">\uF5DC</span>
              <span>${this.getPlanTitle(task.topParentId)}</span>
            </span>
          `;

    let taskDrawer = !this.isDefault(this._currentTargetDrawer)
      ? null
      : html`
          <span class="TaskDetail TaskBucket">
            <span class="TaskIcon">\uF1B6</span>
            <span>${this.getDrawerName(task.immediateParentId)}</span>
          </span>
        `;

    let taskDue = !dueDate
      ? null
      : html`
          <span class="TaskDetail TaskDue">
            <span class="TaskIcon">\uE787</span>
            <span>${getShortDateString(dueDateString)}</span>
          </span>
        `;

    let taskPeople =
      !people || people.length === 0
        ? null
        : html`
            <span class="TaskDetail TaskPeople">
              ${people.map(
                id =>
                  html`
                    <mgt-person user-id="${id}"></mgt-person>
                  `
              )}
            </span>
          `;

    let taskDelete = this.readOnly
      ? null
      : html`
          <span class="TaskIcon TaskDelete">
            <mgt-dot-options
              .options="${{
                'Delete Task': () => this.removeTask(task)
              }}"
            ></mgt-dot-options>
          </span>
        `;

    return html`
      <div class="Task ${taskClass} ${this.readOnly ? 'ReadOnly' : ''}">
        <div class="TaskHeader">
          <span
            class="TaskCheckCont ${taskClass}"
            @click="${e => {
              if (!this.readOnly) {
                if (!task.completed) this.completeTask(task);
                else this.uncompleteTask(task);
              }
            }}"
          >
            ${taskCheck}
          </span>
          <span class="TaskTitle">
            ${name}
          </span>
          ${taskDelete}
        </div>
        <div class="TaskDetails">
          ${taskDresser} ${taskDrawer} ${taskDue} ${taskPeople}
        </div>
      </div>
    `;
  }

  private getTaskSource(): ITaskSource {
    let p = Providers.globalProvider;
    if (!p || p.state !== ProviderState.SignedIn) return null;

    if (this.dataSource === 'planner') return new PlannerTaskSource(p.graph);
    else if (this.dataSource === 'todo') return new TodoTaskSource(p.graph);
    else return null;
  }

  private isAssignedToMe(task: ITask): boolean {
    if (this.dataSource === 'todo') return true;

    let keys = Object.keys(task.assignments);
    return keys.includes(this._me.id);
  }

  private getDateTimeOffset(dateTime: string) {
    let offset = (new Date().getTimezoneOffset() / 60).toString();
    if (offset.length < 2) offset = '0' + offset;

    dateTime = dateTime.replace('Z', `-${offset}:00`);
    return dateTime;
  }

  private getPlanTitle(planId: string): string {
    if (this.isDefault(planId)) return this.res.BASE_SELF_ASSIGNED;
    else if (planId === this.res.PLANS_SELF_ASSIGNED) return this.res.PLANS_SELF_ASSIGNED;
    else
      return (
        this._dressers.find(plan => plan.id === planId) || {
          title: this.res.PLAN_NOT_FOUND
        }
      ).title;
  }

  private getDrawerName(bucketId: string): string {
    if (this.isDefault(bucketId)) return this.res.BUCKETS_SELF_ASSIGNED;
    return (
      this._drawers.find(buck => buck.id === bucketId) || {
        name: this.res.BUCKET_NOT_FOUND
      }
    ).name;
  }

  private isDefault(id: string) {
    for (let res in TASK_RES) {
      for (let prop in TASK_RES[res]) if (id === TASK_RES[res][prop]) return true;
    }

    return false;
  }
}
